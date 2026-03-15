import type { Address } from "viem";

// ── Deployed Contract Addresses (Sepolia) ──

export const ESCROW_ADDRESS = "0x28142241e04784a370C5549Fc89dCc359E0366F1" as Address;
export const HOOK_ADDRESS = "0xb5DaF4Acd89b3222BB2d8D8EfD2C048588Db9A78" as Address;
export const USDT_ADDRESS = "0xd077a400968890eacc75cdc901f0356c943e4fdb" as Address;
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
export const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;

// ── Chain Config ──

export const SEPOLIA_CHAIN_ID = 11155111;
export const EXPLORER_BASE = "https://sepolia.etherscan.io";
export const USDT_DECIMALS = 6;

// ── WDK ERC-4337 Config (Pimlico Sponsored Paymaster) ──

export const WDK_WALLET_NAME = "sepolia";

export function getPimlicoUrl(): string {
  const apiKey = process.env.PIMLICO_API_KEY;
  if (apiKey && apiKey.trim().length > 0) {
    return `https://api.pimlico.io/v2/sepolia/rpc?apikey=${apiKey.trim()}`;
  }
  // Fallback to public endpoint (token paymaster, limited)
  return "https://public.pimlico.io/v2/11155111/rpc";
}

export function getWdkSepoliaConfig() {
  const pimlicoUrl = getPimlicoUrl();
  const hasApiKey = pimlicoUrl.includes("apikey=");

  if (hasApiKey) {
    // Sponsored mode — gas is free, no token approval needed
    return {
      chainId: SEPOLIA_CHAIN_ID,
      blockchain: "ethereum",
      provider: "", // filled at runtime
      bundlerUrl: pimlicoUrl,
      paymasterUrl: pimlicoUrl,
      isSponsored: true,
      entryPointAddress: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
      safeModulesVersion: "0.3.0" as const,
    };
  }

  // Token paymaster fallback — agents pay gas in USDT
  return {
    chainId: SEPOLIA_CHAIN_ID,
    blockchain: "ethereum",
    provider: "", // filled at runtime
    bundlerUrl: pimlicoUrl,
    paymasterUrl: pimlicoUrl,
    paymasterAddress: "0x777777777777AeC03fd955926DbF81597e66834C",
    entryPointAddress: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    safeModulesVersion: "0.3.0" as const,
    paymasterToken: { address: USDT_ADDRESS },
    transferMaxFee: 100000,
  };
}

// ── RPC ──

export function getRpcUrl(): string {
  const rpc = process.env.RPC_URL;
  if (rpc && rpc.trim().length > 0) return rpc.trim();
  throw new Error("RPC_URL environment variable is required");
}

// ── Seed Phrase ──

export function getSeedPhrase(): string {
  const seed = process.env.WDK_SEED;
  if (seed && seed.trim().length > 0) return seed.trim();
  throw new Error("WDK_SEED environment variable is required");
}

// ── IPFS ──

export const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs/";

export function getPinataJwt(): string {
  const jwt = process.env.PINATA_JWT;
  if (jwt && jwt.trim().length > 0) return jwt.trim();
  throw new Error("PINATA_JWT environment variable is required");
}

// ── Helpers ──

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_BASE}/address/${address}`;
}
