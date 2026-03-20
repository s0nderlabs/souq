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

// MARK: - x402 Fetch Wrapper

/**
 * x402-aware fetch wrapper for Souq API calls.
 *
 * Flow:
 * 1. Make initial request to the Souq API
 * 2. If 402 returned, parse payment requirements
 * 3. Use x402Client to create signed payment payload
 * 4. Retry with X-Payment header
 * 5. Return response
 *
 * @param path - API path (e.g., "/pin", "/rpc")
 * @param init - Standard RequestInit options
 * @returns Response from server
 */
export async function x402Fetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const apiUrl = getSouqApiUrl();
  const url = `${apiUrl}${path}`;

  // Step 1: Make initial request
  const initialResponse = await fetch(url, init);

  // If not 402, return as-is
  if (initialResponse.status !== 402) {
    return initialResponse;
  }

  // Step 2: Parse 402 response
  let paymentRequired: PaymentRequired;
  try {
    paymentRequired = (await initialResponse.json()) as PaymentRequired;
  } catch {
    throw new Error("Invalid 402 response: could not parse payment requirements");
  }

  if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
    throw new Error("No payment options available in 402 response");
  }

  // Step 3: Create payment payload via x402Client
  const httpClient = await getHttpClient();
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);

  // Step 4: Encode and retry with payment header
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  const originalHeaders = init?.headers instanceof Headers
    ? Object.fromEntries(init.headers.entries())
    : (init?.headers as Record<string, string>) || {};

  const paidInit: RequestInit = {
    ...init,
    headers: {
      ...originalHeaders,
      ...paymentHeaders,
    },
  };

  const paidResponse = await fetch(url, paidInit);

  // Check for payment rejection
  if (paidResponse.status === 402) {
    let errorMessage = "Payment rejected";
    try {
      const errorBody = (await paidResponse.json()) as { reason?: string; message?: string };
      errorMessage = `Payment rejected: ${errorBody.reason || errorBody.message || "Unknown reason"}`;
    } catch {
      // Use default error message
    }
    throw new Error(errorMessage);
  }

  return paidResponse;
}

/**
 * Reset cached client (call when wallet changes).
 */
export function resetX402Client(): void {
  cachedHttpClient = null;
}
