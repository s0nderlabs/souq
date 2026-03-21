// x402-client.ts — x402-aware fetch wrapper for Souq plugin
// Adapts WDK ERC-4337 smart account to x402 ClientEvmSigner
// Copyright (c) 2026 s0nderlabs

import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { toClientEvmSigner, type ClientEvmSigner } from "@x402/evm";
import { hashTypedData } from "viem";
import { getWdkAccount, getAddress, getPublicClient } from "./protocol.js";
import { getSouqApiUrl, SEPOLIA_CHAIN_ID } from "./config.js";

// MARK: - Constants

const X_PAYMENT_HEADER = "x-payment";

// MARK: - WDK Signer Adapter

/**
 * Creates a ClientEvmSigner from the WDK ERC-4337 account.
 *
 * The key insight: `signer.address` must be the Safe address (the token holder),
 * and `signer.signTypedData()` produces a Safe-compatible ERC-1271 signature.
 *
 * Safe's isValidSignature(hash, sig) wraps the input hash as:
 *   safeMessageHash = EIP-712(domain: {chainId, verifyingContract: Safe},
 *                             SafeMessage(bytes message) = hash)
 * Then verifies ecrecover(safeMessageHash, sig) is an owner.
 *
 * So the EOA must sign the SafeMessage-wrapped hash, not the raw typed data hash.
 *
 * Verification paths:
 *   Facilitator (off-chain): ECDSA fails → ERC-1271 → Safe.isValidSignature → passes
 *   USDT0Mock (on-chain):    SignatureChecker → ECDSA fails → ERC-1271 → passes
 */
async function createWdkSigner(): Promise<ClientEvmSigner> {
  const account = await getWdkAccount();
  const safeAddress = await getAddress();
  const publicClient = getPublicClient();

  // Adapter: WDK account -> x402 ClientEvmSigner
  const signerBase = {
    address: safeAddress as `0x${string}`,

    async signTypedData(message: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<`0x${string}`> {
      // Step 1: Compute the raw EIP-712 typed data hash (e.g., TransferWithAuthorization)
      const typedDataHash = hashTypedData({
        domain: message.domain as Parameters<typeof hashTypedData>[0]["domain"],
        types: message.types as Parameters<typeof hashTypedData>[0]["types"],
        primaryType: message.primaryType,
        message: message.message as Parameters<typeof hashTypedData>[0]["message"],
      });

      // Step 2: Sign the SafeMessage-wrapped hash via WDK's EOA
      // Safe's isValidSignature(typedDataHash, sig) internally computes:
      //   safeMessageHash = hashTypedData({
      //     domain: { chainId, verifyingContract: safeAddress },
      //     types: { SafeMessage: [{ type: "bytes", name: "message" }] },
      //     message: { message: abi.encode(typedDataHash) }
      //   })
      // Then checks ecrecover(safeMessageHash, sig) is an owner.
      // By signing the SafeMessage typed data, the EOA signs safeMessageHash directly.
      const signature = await account.signTypedData({
        domain: { verifyingContract: safeAddress, chainId: SEPOLIA_CHAIN_ID },
        types: { SafeMessage: [{ name: "message", type: "bytes" }] },
        message: { message: typedDataHash },
      });
      return signature as `0x${string}`;
    },
  };

  // Use toClientEvmSigner to compose with publicClient for readContract
  return toClientEvmSigner(signerBase, {
    readContract: (args: {
      address: `0x${string}`;
      abi: readonly unknown[];
      functionName: string;
      args?: readonly unknown[];
    }) => publicClient.readContract({
      address: args.address,
      abi: args.abi as readonly unknown[],
      functionName: args.functionName,
      args: args.args,
    }),
  });
}

// MARK: - x402 HTTP Client (cached)

let cachedHttpClient: x402HTTPClient | null = null;

async function getHttpClient(): Promise<x402HTTPClient> {
  if (cachedHttpClient) return cachedHttpClient;

  const signer = await createWdkSigner();

  const client = new x402Client();
  registerExactEvmScheme(client, { signer });

  cachedHttpClient = new x402HTTPClient(client);
  return cachedHttpClient;
}

// Note: EIP-3009 transferWithAuthorization uses random nonces (not sequential),
// so concurrent payments are safe — no serialization needed.

// MARK: - x402 Fetch (uses originalFetch to avoid recursion with global patch)

import { originalFetch } from "./x402-fetch-patch.js";

/**
 * x402-aware fetch for a full URL. Used by the global fetch patch and x402 transport.
 * Uses `originalFetch` (the unpatched fetch) to avoid infinite recursion.
 */
export async function x402FetchRaw(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const apiUrl = getSouqApiUrl();
  const url = `${apiUrl}${path}`;

  // Ensure X-SOUQ-WALLET header is set for bootstrap middleware
  if (!init?.headers || !(init.headers as Record<string, string>)["X-SOUQ-WALLET"]) {
    try {
      const { getAddress } = await import("./protocol.js");
      const addr = await getAddress();
      const existingHeaders = init?.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : (init?.headers as Record<string, string>) || {};
      init = { ...init, headers: { ...existingHeaders, "X-SOUQ-WALLET": addr } };
    } catch {
      // WDK not initialized yet — proceed without wallet header
    }
  }

  // Step 1: Probe with originalFetch (retry on transient network errors)
  let initialResponse: Response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      initialResponse = await originalFetch(url, init);
      break;
    } catch (err) {
      if (attempt === 2) throw err;
      console.error(`[souq] x402 probe failed (attempt ${attempt + 1}/3): ${err instanceof Error ? err.message : err}`);
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
    }
  }

  if (initialResponse!.status !== 402) {
    return initialResponse!;
  }

  // Step 2: Parse 402 response
  let paymentRequired: PaymentRequired;
  try {
    paymentRequired = (await initialResponse!.json()) as PaymentRequired;
  } catch {
    throw new Error("Invalid 402 response: could not parse payment requirements");
  }
  if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
    throw new Error("No payment options available in 402 response");
  }

  // Step 3: Sign payment (EIP-3009 uses random nonces — concurrent payments are safe)
  const httpClient = await getHttpClient();
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const encodedPayment = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const paymentValue = typeof encodedPayment === "string"
    ? encodedPayment
    : (encodedPayment as Record<string, string>)["PAYMENT-SIGNATURE"] ?? Object.values(encodedPayment as Record<string, string>)[0];

  // Step 4: Retry with payment header
  const existingHeaders = init?.headers instanceof Headers
    ? Object.fromEntries(init.headers.entries())
    : (init?.headers as Record<string, string>) || {};

  const paidResponse = await originalFetch(url, {
    ...init,
    headers: { ...existingHeaders, "x-payment": paymentValue },
  });

  if (paidResponse.status === 402) {
    let msg = "Payment rejected";
    try {
      const body = (await paidResponse.json()) as { reason?: string; message?: string };
      msg = `Payment rejected: ${body.reason || body.message || "Unknown reason"}`;
    } catch { /* use default */ }
    throw new Error(msg);
  }

  return paidResponse;
}

/** Alias for backward compatibility. */
export const x402Fetch = x402FetchRaw;

/**
 * Handle x402 payment given an already-received 402 response.
 * Avoids a redundant probe when the caller already has the 402 body.
 */
export async function handleX402Payment(
  url: string,
  init: RequestInit | undefined,
  response402: Response
): Promise<Response> {
  let paymentRequired: PaymentRequired;
  try {
    paymentRequired = (await response402.json()) as PaymentRequired;
  } catch {
    throw new Error("Invalid 402 response: could not parse payment requirements");
  }
  if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
    throw new Error("No payment options available in 402 response");
  }

  const httpClient = await getHttpClient();
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const encodedPayment = httpClient.encodePaymentSignatureHeader(paymentPayload);
  const paymentValue = typeof encodedPayment === "string"
    ? encodedPayment
    : (encodedPayment as Record<string, string>)["PAYMENT-SIGNATURE"] ?? Object.values(encodedPayment as Record<string, string>)[0];

  const existingHeaders = init?.headers instanceof Headers
    ? Object.fromEntries(init.headers.entries())
    : (init?.headers as Record<string, string>) || {};

  const paidResponse = await originalFetch(url, {
    ...init,
    headers: { ...existingHeaders, "x-payment": paymentValue },
  });

  if (paidResponse.status === 402) {
    let msg = "Payment rejected";
    try {
      const body = (await paidResponse.json()) as { reason?: string; message?: string };
      msg = `Payment rejected: ${body.reason || body.message || "Unknown reason"}`;
    } catch { /* use default */ }
    throw new Error(msg);
  }
  return paidResponse;
}

/**
 * Reset cached client (call when wallet changes).
 */
export function resetX402Client(): void {
  cachedHttpClient = null;
}
