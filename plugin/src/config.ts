import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Address } from "viem";

// ── Deployed Contract Addresses (Sepolia) ──

export const ESCROW_ADDRESS = "0x2AE839f237187102713c8c05736fda65430B17f0" as Address;
export const HOOK_ADDRESS = "0xEB5d16A2A2617e22ffDD85CD75f709E5eF0fb2EF" as Address;
export const USDT_ADDRESS = "0xABfd273ef83Ed85DBe776E4311118c3F2da27469" as Address; // USDT0Mock
export const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
export const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address;
export const SIGIL_ADDRESS = "0x2A1F759EC07d1a4177f845666dA0a6d82c37c11f" as Address;
export const TREASURY_ADDRESS = "0x06B74fe8070C96D92e3a2A8A871849Ac81e4c09e" as Address;

// ── Chain Config ──

export const SEPOLIA_CHAIN_ID = 11155111;
export const EXPLORER_BASE = "https://sepolia.etherscan.io";
export const USDT_DECIMALS = 6;

// ── Backend API ──

export const SOUQ_API_URL = process.env.SOUQ_API_URL || "https://api.souq.s0nderlabs.xyz";

export function getSouqApiUrl(): string {
  return SOUQ_API_URL;
}

// ── WDK ERC-4337 Config (routes through backend) ──

export const WDK_WALLET_NAME = "sepolia";

export function getBundlerUrl(): string {
  return `${getSouqApiUrl()}/bundler`;
}

export function getWdkSepoliaConfig() {
  // ALL WDK traffic routes through our backend.
  // /bundler has smart routing: standard RPC → Ankr, bundler methods → Pimlico.
  // The global fetch patch (x402-fetch-patch.ts) adds x402 payment automatically.
  const bundlerUrl = getBundlerUrl();

  return {
    chainId: SEPOLIA_CHAIN_ID,
    blockchain: "ethereum",
    provider: bundlerUrl,    // smart-routes to Ankr for reads, Pimlico for bundler
    bundlerUrl: bundlerUrl,  // through our x402-paid backend proxy
    paymasterUrl: bundlerUrl, // through our x402-paid backend proxy
    isSponsored: true,
    entryPointAddress: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
    safeModulesVersion: "0.3.0" as const,
  };
}

// ── RPC ──

export function getRpcUrl(): string {
  return `${getSouqApiUrl()}/rpc`;
}

// ── Seed Phrase ──

const SOUQ_SEED_DIR = join(homedir(), ".souq");
const SOUQ_SEED_PATH = join(SOUQ_SEED_DIR, "seed");

export function getSeedPhrase(): string {
  // 1. Check WDK_SEED env var
  const envSeed = process.env.WDK_SEED;
  if (envSeed && envSeed.trim().length > 0) return envSeed.trim();

  // 2. Check ~/.souq/seed file
  if (existsSync(SOUQ_SEED_PATH)) {
    const fileSeed = readFileSync(SOUQ_SEED_PATH, "utf-8").trim();
    if (fileSeed.length > 0) return fileSeed;
  }

  // 3. Generate new seed phrase via WDK and save it
  // Use dynamic import to avoid circular deps (config is loaded before WDK is available)
  // This is a sync function, so we generate using the seed path placeholder
  // and the actual generation happens in getOrCreateSeedPhrase() async variant
  throw new Error(
    "No seed phrase found. Call getOrCreateSeedPhrase() to auto-generate one, " +
    "or set WDK_SEED env var, or place a seed in ~/.souq/seed"
  );
}

/**
 * Async version that can auto-generate a seed phrase if none exists.
 * Checks WDK_SEED env -> ~/.souq/seed file -> generates new via WDK.
 */
export async function getOrCreateSeedPhrase(): Promise<string> {
  // 1. Check WDK_SEED env var
  const envSeed = process.env.WDK_SEED;
  if (envSeed && envSeed.trim().length > 0) return envSeed.trim();

  // 2. Check ~/.souq/seed file
  if (existsSync(SOUQ_SEED_PATH)) {
    const fileSeed = readFileSync(SOUQ_SEED_PATH, "utf-8").trim();
    if (fileSeed.length > 0) return fileSeed;
  }

  // 3. Generate new seed phrase via WDK
  const WDK = (await import("@tetherto/wdk")).default;
  const seed = WDK.getRandomSeedPhrase();

  // Save to ~/.souq/seed with owner-only permissions
  if (!existsSync(SOUQ_SEED_DIR)) {
    mkdirSync(SOUQ_SEED_DIR, { recursive: true, mode: 0o700 });
  }
  writeFileSync(SOUQ_SEED_PATH, seed + "\n", { mode: 0o600 });

  console.error(`[souq] Generated new seed phrase, saved to ${SOUQ_SEED_PATH}`);
  return seed;
}

// ── Helpers ──

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`;
}

export function explorerAddressUrl(address: string): string {
  return `${EXPLORER_BASE}/address/${address}`;
}
