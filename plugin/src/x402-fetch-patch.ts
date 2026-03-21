// x402-fetch-patch.ts — Patches globalThis.fetch so WDK's internal HTTP calls
// go through x402 payment when targeting the Souq backend.
// Must be called BEFORE WDK is initialized.
// Copyright (c) 2026 s0nderlabs

import { getSouqApiUrl } from "./config.js";

/** The original, unpatched fetch — used by x402-client.ts to avoid recursion. */
export let originalFetch: typeof globalThis.fetch = globalThis.fetch;

/**
 * Patches globalThis.fetch to intercept calls to the Souq backend.
 *
 * WDK's Safe4337Pack calls the bundler/paymaster URLs internally via plain fetch.
 * Since WDK has no x402 support, we intercept those calls here and add payment.
 *
 * The x402 flow:
 * 1. WDK calls fetch("https://api.souq.s0nderlabs.xyz/bundler", { body: ... })
 * 2. Patched fetch detects SOUQ_API_URL prefix
 * 3. Delegates to x402FetchRaw which handles 402 → sign → retry
 * 4. Returns the paid response to WDK
 */
export function patchFetchForX402(): void {
  originalFetch = globalThis.fetch; // capture BEFORE patching
  const apiUrl = getSouqApiUrl();

  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    // Only intercept calls to OUR backend
    if (url.startsWith(apiUrl)) {
      const path = url.slice(apiUrl.length); // e.g., "/bundler", "/rpc"

      // Add wallet header for bootstrap middleware (lazy — may not be initialized yet)
      let walletInit = init;
      try {
        const { getAddress } = await import("./protocol.js");
        const addr = await getAddress();
        const existingHeaders = init?.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : (init?.headers as Record<string, string>) || {};
        walletInit = { ...init, headers: { ...existingHeaders, "X-SOUQ-WALLET": addr } };
      } catch {
        // WDK not initialized yet (e.g., during Safe deployment) — skip wallet header
      }

      const { x402FetchRaw } = await import("./x402-client.js");
      return x402FetchRaw(path, walletInit);
    }

    // Everything else passes through unchanged
    return originalFetch(input, init);
  }) as typeof globalThis.fetch;
}
