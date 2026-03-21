import { createMiddleware } from "hono/factory";
import type { AppContext, BootstrapRecord } from "../types";
import { BOOTSTRAP_LIMIT } from "../types";

/**
 * Bootstrap Middleware
 *
 * Gives new agents N free calls before x402 kicks in.
 * Bootstrap record is created when the agent claims faucet tokens.
 *
 * Flow:
 * 1. No wallet header → pass through to x402
 * 2. Not bootstrapped → pass through to x402
 * 3. Quota exhausted → pass through to x402
 * 4. Free calls remaining → increment count, mark verified, skip x402
 */
export const bootstrapMiddleware = createMiddleware<AppContext>(
  async (c, next) => {
    const wallet = c.req.header("X-SOUQ-WALLET");

    if (!wallet) {
      await next();
      return;
    }

    c.set("wallet", wallet);

    const key = `bootstrap:${wallet.toLowerCase()}`;
    const record = await c.env.BOOTSTRAP_KV.get<BootstrapRecord>(key, "json");

    if (!record) {
      await next();
      return;
    }

    if (record.callCount >= BOOTSTRAP_LIMIT) {
      await next();
      return;
    }

    // Has free calls remaining — increment and mark as verified
    record.callCount += 1;
    await c.env.BOOTSTRAP_KV.put(key, JSON.stringify(record));

    c.set("paymentVerified", true);
    c.set("paymentAmount", 0n);

    await next();
  }
);
