import { createMiddleware } from "hono/factory";
import type { AppContext } from "../types";

// Read-only methods that never cost money (bundler + standard RPC reads)
// WDK routes standard RPC calls through /bundler because provider = bundlerUrl
const READ_ONLY_METHODS = new Set([
  // Bundler-specific read methods
  "pimlico_getUserOperationGasPrice",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "pimlico_getUserOperationStatus",
  "eth_chainId",
  "eth_supportedEntryPoints",
  // Standard RPC reads (WDK calls these on /bundler via smart routing)
  "eth_getCode",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
  "eth_call",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "eth_feeHistory",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
]);

// Methods that require UserOp inspection for deployment detection
const DEPLOYMENT_METHODS = new Set([
  "eth_sendUserOperation",
  "pm_getPaymasterStubData",
  "pm_getPaymasterData",
  "pm_sponsorUserOperation",
  "eth_estimateUserOperationGas",
]);

function isDeploymentUserOp(userOp: Record<string, unknown>): boolean {
  const factory = userOp.factory as string | undefined;
  if (factory && factory !== "0x" && factory.length >= 42) return true;
  const initCode = userOp.initCode as string | undefined;
  if (initCode && initCode !== "0x" && initCode.length > 42) return true;
  return false;
}

function extractUserOp(params: unknown[] | undefined): Record<string, unknown> | null {
  if (!Array.isArray(params)) return null;
  const first = params[0];
  return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
}

/**
 * Deployment-Exempt Middleware
 *
 * Sits between bootstrap and x402 middleware, specifically for /bundler.
 * Exempts read-only calls + Safe deployment operations from x402 payment.
 *
 * IMPORTANT: Uses c.req.clone() to avoid consuming the request body,
 * so the downstream bundler route handler can still read it.
 */
export const deploymentExemptMiddleware = createMiddleware<AppContext>(
  async (c, next) => {
    if (c.get("paymentVerified")) {
      await next();
      return;
    }

    // Clone the request to read body without consuming it for downstream handlers
    let body: { method?: string; params?: unknown[] };
    try {
      const cloned = c.req.raw.clone();
      body = await cloned.json();
    } catch {
      await next();
      return;
    }

    const method = body.method;
    if (!method) {
      await next();
      return;
    }

    // Read-only methods are always free
    if (READ_ONLY_METHODS.has(method)) {
      c.set("paymentVerified", true);
      c.set("paymentAmount", 0n);
      await next();
      return;
    }

    // For deployment-related methods, check if the UserOp has factory/initCode
    if (DEPLOYMENT_METHODS.has(method)) {
      const userOp = extractUserOp(body.params);
      if (userOp && isDeploymentUserOp(userOp)) {
        c.set("paymentVerified", true);
        c.set("paymentAmount", 0n);
        await next();
        return;
      }
    }

    // Not exempt — let x402 handle payment
    await next();
  }
);
