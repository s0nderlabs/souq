import { Hono } from "hono";
import type { AppContext } from "../types";
import { getPimlicoUrl } from "../config";

const bundler = new Hono<AppContext>();

/**
 * POST /bundler
 * Proxy JSON-RPC requests to Pimlico bundler for ERC-4337 operations.
 * Responses are buffered (not streamed) to avoid middleware issues.
 */
// Standard RPC methods that Pimlico doesn't support — route to Alchemy instead
const RPC_METHODS = new Set([
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_getBalance",
  "eth_getCode",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_call",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "eth_feeHistory",
]);

bundler.post("/bundler", async (c) => {
  const body = await c.req.text();
  let parsed: { method: string; id?: unknown; jsonrpc?: string; params?: unknown[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  const method = parsed.method;
  const pimlicoUrl = getPimlicoUrl(c.env.PIMLICO_API_KEY);

  // Intercept gas price methods — return Pimlico-compatible prices
  // Pimlico requires higher gas prices than Alchemy reports
  if (method === "eth_gasPrice" || method === "eth_maxPriorityFeePerGas") {
    const gasPriceRes = await fetch(pimlicoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "pimlico_getUserOperationGasPrice",
        params: [],
        id: parsed.id,
      }),
    });
    const gasPriceData = (await gasPriceRes.json()) as {
      result?: { fast: { maxFeePerGas: string; maxPriorityFeePerGas: string } };
    };
    const fast = gasPriceData.result?.fast;
    const value = method === "eth_gasPrice" ? fast?.maxFeePerGas : fast?.maxPriorityFeePerGas;
    return c.json({ jsonrpc: "2.0", id: parsed.id, result: value ?? "0x3B9ACA00" });
  }

  // Route standard RPC methods to Alchemy, bundler methods to Pimlico
  const url = RPC_METHODS.has(method) ? c.env.RPC_URL : pimlicoUrl;
  console.log(`[bundler] ${method} → ${RPC_METHODS.has(method) ? "alchemy" : "pimlico"}`);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  return new Response(response.body, {
    status: response.status,
    headers: { "Content-Type": "application/json" },
  });
});

export default bundler;
