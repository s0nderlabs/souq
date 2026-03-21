// x402-transport.ts — viem HTTP transport with x402 payment via fetchFn.
// Uses pragma's pattern: http(url, { fetchFn }) — lets viem handle JSON-RPC
// protocol (batching, retries, polling) while x402 handles payment transparently.
// Copyright (c) 2026 s0nderlabs

import { http } from "viem";
import { getSouqApiUrl } from "./config.js";
import { originalFetch } from "./x402-fetch-patch.js";

/**
 * Creates an x402-aware viem HTTP transport.
 *
 * Wraps the standard http() transport with a custom fetchFn that:
 * 1. Adds X-SOUQ-WALLET header for bootstrap middleware
 * 2. On 402 → delegates to x402FetchRaw for payment signing + retry
 *
 * Unlike custom() transport, this preserves viem's built-in polling,
 * batching, and retry logic — critical for waitForTransactionReceipt.
 */
export function createX402Transport() {
  const rpcUrl = `${getSouqApiUrl()}/rpc`;

  // Cached wallet address to avoid repeated async lookups
  let cachedWallet: string | null = null;

  const x402FetchFn: typeof fetch = async (input, init) => {
    // Add wallet header for bootstrap
    const headers = new Headers(init?.headers);
    if (!cachedWallet) {
      try {
        const { getAddress } = await import("./protocol.js");
        cachedWallet = await getAddress();
      } catch {
        // WDK not initialized yet
      }
    }
    if (cachedWallet) {
      headers.set("X-SOUQ-WALLET", cachedWallet);
    }

    // Probe with retry (transient network errors on Cloudflare can cause fetch to fail)
    let response: Response;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await originalFetch(input, { ...init, headers });
        break;
      } catch (err) {
        if (attempt === 2) throw err;
        console.error(`[souq] x402 transport probe failed (attempt ${attempt + 1}/3): ${err instanceof Error ? err.message : err}`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }

    // If not 402, return as-is (bootstrap or free)
    if (response!.status !== 402) {
      return response!;
    }

    // 402 → handle payment using the already-received 402 response (no re-probe)
    const { handleX402Payment } = await import("./x402-client.js");
    const url = typeof input === "string" ? input : (input as Request).url;
    return handleX402Payment(url, init, response!);
  };

  return http(rpcUrl, {
    retryCount: 0,
    timeout: 60_000, // 60s — x402 flow needs probe + payment signing + retry
    fetchFn: x402FetchFn,
  } as any);
}

