import { createMiddleware } from "hono/factory";
import type { AppContext, PriceConfig } from "../types";
import { ROUTE_PRICING } from "../types";
import { NETWORK } from "../config";
import { getFacilitator } from "../facilitator";
import {
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from "@x402/core/http";
import type { PaymentRequired, PaymentRequirements, PaymentPayload } from "@x402/core/types";
import { x402Version } from "@x402/core";
import type { x402Facilitator } from "@x402/core/facilitator";

// x402 Header names
const X_PAYMENT = "x-payment";
const X_PAYMENT_RESPONSE = "x-payment-response";

// Settlement queue to prevent nonce conflicts from concurrent requests
let settlementQueue: Promise<void> = Promise.resolve();

function logTiming(label: string, startMs: number): void {
  console.log(`[x402] ${label}: ${Date.now() - startMs}ms`);
}

/**
 * Queues a background settlement task using Cloudflare Workers waitUntil.
 * Settlements are chained to prevent nonce conflicts from concurrent requests.
 */
function queueBackgroundSettlement(
  c: { executionCtx?: { waitUntil?: (promise: Promise<void>) => void } },
  facilitator: x402Facilitator,
  paymentPayload: PaymentPayload,
  requirements: PaymentRequirements
): void {
  const settleTask = async () => {
    const start = Date.now();
    try {
      const result = await facilitator.settle(paymentPayload, requirements);
      console.log(`[x402] Background settle: ${Date.now() - start}ms - ${result.success ? "success" : "failed"}`);
    } catch (error) {
      console.error(`[x402] Background settle failed after ${Date.now() - start}ms:`, error);
    }
  };

  settlementQueue = settlementQueue.then(settleTask).catch(() => {});

  // Use waitUntil to keep the worker alive until settlement completes
  const ctx = c.executionCtx as { waitUntil?: (promise: Promise<void>) => void } | undefined;
  ctx?.waitUntil?.(settlementQueue);
}

/**
 * Extracts the route type from a path and returns pricing config.
 *
 * @param path - Request path like "/rpc" or "/pin"
 * @returns Pricing config or null if route is free or unpriced
 */
export function getRoutePrice(path: string): PriceConfig | null {
  const segment = path.split("/").filter(Boolean)[0];
  if (!segment) return null;

  const price = ROUTE_PRICING[segment];
  if (!price || price.amount === "0") return null;
  return price;
}

/**
 * x402 Payment Middleware
 *
 * Handles payment verification and settlement for protected routes.
 *
 * Flow:
 * 1. Check if route needs payment
 * 2. If no payment header, return 402 with requirements
 * 3. If payment header, verify and process request
 * 4. After successful response, settle payment in background
 */
export const x402Middleware = createMiddleware<AppContext>(async (c, next) => {
  // Skip if already verified (bootstrap free tier or deployment-exempt)
  if (c.get("paymentVerified")) {
    await next();
    return;
  }

  // Get pricing for this route
  const price = getRoutePrice(c.req.path);
  if (!price) {
    // No pricing configured or free route, pass through
    await next();
    return;
  }

  const { facilitator, revenueWallet, usdtAddress } = getFacilitator(c.env);

  // Check for payment header
  const paymentHeader = c.req.header(X_PAYMENT);
  console.log(`[x402] ${c.req.method} ${c.req.path} | payment header: ${paymentHeader ? `${paymentHeader.length} chars` : "NONE"}`);

  // USDT0Mock EIP-712 domain (from ERC20Permit constructor: name="USDT0", version="1")
  const eip712Domain = {
    name: "USDT0",
    version: "1",
  };

  if (!paymentHeader) {
    // No payment provided, return 402 with requirements
    const paymentRequired: PaymentRequired = {
      x402Version,
      resource: {
        url: c.req.url,
        description: `API call to ${c.req.path}`,
        mimeType: "application/json",
      },
      accepts: [
        {
          scheme: "exact",
          network: NETWORK, // "eip155:11155111"
          amount: price.amount,
          payTo: revenueWallet,
          maxTimeoutSeconds: 300, // 5 minute validity
          asset: usdtAddress,
          extra: eip712Domain,
        },
      ],
      error: "Payment Required",
    };

    return c.json(paymentRequired, 402, {
      [X_PAYMENT_RESPONSE]: encodePaymentRequiredHeader(paymentRequired),
    });
  }

  // Payment header present, decode and verify
  try {
    const totalStart = Date.now();
    const paymentPayload = decodePaymentSignatureHeader(paymentHeader);

    const requirements: PaymentRequirements = {
      scheme: "exact",
      network: NETWORK,
      amount: price.amount,
      payTo: revenueWallet,
      asset: usdtAddress,
      maxTimeoutSeconds: 300,
      extra: eip712Domain,
    };

    // Verify the payment
    const verifyStart = Date.now();
    const verifyResult = await facilitator.verify(paymentPayload, requirements);
    logTiming("Verify", verifyStart);

    if (!verifyResult.isValid) {
      return c.json(
        {
          error: "Invalid Payment",
          reason: verifyResult.invalidReason,
          x402Version,
        },
        402
      );
    }

    // Payment valid, mark as verified
    c.set("paymentVerified", true);
    c.set("paymentAmount", BigInt(price.amount));

    // Process the actual request
    const backendStart = Date.now();
    await next();
    logTiming("Backend", backendStart);

    // After successful response (2xx), settle the payment in background
    const isSuccess = c.res.status >= 200 && c.res.status < 300;
    logTiming(isSuccess ? "Total (before settle)" : "Total (no settle)", totalStart);

    if (isSuccess) {
      queueBackgroundSettlement(c, facilitator, paymentPayload, requirements);
    }
  } catch (error) {
    return c.json(
      {
        error: "Payment Processing Error",
        message: error instanceof Error ? error.message : "Unknown error",
        x402Version,
      },
      400
    );
  }
});
