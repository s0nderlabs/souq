import { x402Facilitator } from "@x402/core/facilitator";
import { registerExactEvmScheme } from "@x402/evm/exact/facilitator";
import { createFacilitatorSigner } from "./signer";
import { NETWORK } from "../config";
import type { Env } from "../types";

export interface FacilitatorInstance {
  facilitator: x402Facilitator;
  address: `0x${string}`;
  revenueWallet: `0x${string}`;
  usdtAddress: `0x${string}`;
}

// Cache the facilitator instance per env (for Cloudflare Workers)
let cachedFacilitator: FacilitatorInstance | null = null;

/**
 * Creates and configures the x402 facilitator for Sepolia.
 *
 * @param env - Environment bindings with secrets
 * @returns Configured facilitator instance
 */
export function createFacilitator(env: Env): FacilitatorInstance {
  const signer = createFacilitatorSigner(
    env.FACILITATOR_PRIVATE_KEY as `0x${string}`,
    env.RPC_URL
  );

  const facilitator = new x402Facilitator();

  // Register EVM exact scheme for Sepolia
  // deployERC4337WithEIP6492: handle Smart Account (Safe) signatures
  // The facilitator will deploy the Safe if not yet deployed during settlement
  registerExactEvmScheme(facilitator, {
    signer,
    networks: NETWORK, // "eip155:11155111"
    deployERC4337WithEIP6492: true,
  });

  const addresses = signer.getAddresses();
  const facilitatorAddress = addresses[0];
  if (!facilitatorAddress) {
    throw new Error("Facilitator signer has no addresses");
  }

  return {
    facilitator,
    address: facilitatorAddress,
    revenueWallet: env.TREASURY_ADDRESS as `0x${string}`,
    usdtAddress: env.USDT_ADDRESS as `0x${string}`,
  };
}

/**
 * Gets or creates the facilitator instance.
 * Uses simple caching for the Workers environment.
 */
export function getFacilitator(env: Env): FacilitatorInstance {
  if (!cachedFacilitator) {
    cachedFacilitator = createFacilitator(env);
  }
  return cachedFacilitator;
}

/**
 * Resets the cached facilitator (useful for testing).
 */
export function resetFacilitator(): void {
  cachedFacilitator = null;
}
