import { Hono } from "hono";
import {
  createWalletClient,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AppContext } from "../types";
import { FAUCET_AMOUNT } from "../types";
import { sepolia } from "../config";

const faucet = new Hono<AppContext>();

const erc20TransferAbi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

/**
 * POST /faucet
 * Sends 100 USDT0 to a new wallet. Rate-limited: one claim per address via KV.
 *
 * Request body: { address: "0x..." }
 * Response: { success: true, amount: "10", txHash: "0x..." }
 */
faucet.post("/faucet", async (c) => {
  const body = await c.req.json<{ address?: string }>();
  const address = body.address;

  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return c.json({ error: "Invalid address format" }, 400);
  }

  // Check if already claimed
  const kvKey = `faucet:${address.toLowerCase()}`;
  const existing = await c.env.BOOTSTRAP_KV.get(kvKey);

  if (existing) {
    return c.json({ error: "Faucet already claimed for this address" }, 409);
  }

  // Send USDT
  try {
    const account = privateKeyToAccount(
      c.env.FAUCET_PRIVATE_KEY as `0x${string}`
    );

    const client = createWalletClient({
      account,
      chain: sepolia,
      transport: http(c.env.RPC_URL),
    });

    const txHash = await client.writeContract({
      address: c.env.USDT_ADDRESS as `0x${string}`,
      abi: erc20TransferAbi,
      functionName: "transfer",
      args: [address as `0x${string}`, FAUCET_AMOUNT],
    });

    // Record the faucet claim
    await c.env.BOOTSTRAP_KV.put(
      kvKey,
      JSON.stringify({ claimedAt: Date.now() })
    );

    // Create bootstrap record — gives N free API calls for onboarding
    const bootstrapKey = `bootstrap:${address.toLowerCase()}`;
    await c.env.BOOTSTRAP_KV.put(
      bootstrapKey,
      JSON.stringify({ claimedAt: Date.now(), callCount: 0 })
    );

    return c.json({
      success: true,
      amount: "100",
      txHash,
    });
  } catch (error) {
    console.error("[faucet] Transfer failed:", error);
    return c.json(
      {
        error: "Faucet transfer failed",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

export default faucet;
