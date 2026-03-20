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

export function getIpfsGateway(cid: string): string {
  return `https://gateway.pinata.cloud/ipfs/${cid}`;
}
