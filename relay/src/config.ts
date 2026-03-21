import type { Chain } from "viem";

export const SEPOLIA_CHAIN_ID = 11155111;
export const NETWORK = `eip155:${SEPOLIA_CHAIN_ID}`;

export const sepolia: Chain = {
  id: SEPOLIA_CHAIN_ID,
  name: "Sepolia",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [] } },
};

export const USDT_DECIMALS = 6;

export function getPimlicoUrl(apiKey: string): string {
  return `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey}`;
}

/**
 * Returns the Pinata gateway URL for a CID.
 * Uses dedicated gateway endpoint with JWT auth header.
 */
export function getPinataGatewayUrl(cid: string): string {
  return `https://gateway.pinata.cloud/ipfs/${cid}`;
}

/** Fallback public gateways (no auth needed). */
export function getFallbackGateways(cid: string): string[] {
  return [
    `https://cloudflare-ipfs.com/ipfs/${cid}`,
    `https://dweb.link/ipfs/${cid}`,
  ];
}
