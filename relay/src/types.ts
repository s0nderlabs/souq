export type Env = {
  // Durable Objects
  RELAY: DurableObjectNamespace;

  // KV
  BOOTSTRAP_KV: KVNamespace;

  // Secrets (set via wrangler secret put)
  RPC_URL: string;
  PIMLICO_API_KEY: string;
  PINATA_JWT: string;
  FAUCET_PRIVATE_KEY: string;
  FACILITATOR_PRIVATE_KEY: string;
  SIGIL_API_KEY: string;

  // Vars (set in wrangler.toml)
  CHAIN_ID: string;
  USDT_ADDRESS: string;
  TREASURY_ADDRESS: string;
  ESCROW_ADDRESS: string;
  SIGIL_SERVER_URL: string;
};

export type Variables = {
  wallet?: string;
  paymentVerified?: boolean;
  paymentAmount?: bigint;
};

export type AppContext = { Bindings: Env; Variables: Variables };

export interface PriceConfig {
  amount: string;
  currency: string;
}

// Pricing in USDT base units (6 decimals)
export const ROUTE_PRICING: Record<string, PriceConfig> = {
  rpc: { amount: "1000", currency: "USDT" },       // 0.001 USDT
  bundler: { amount: "1000", currency: "USDT" },   // 0.001 USDT
  pin: { amount: "10000", currency: "USDT" },      // 0.01 USDT
  ipfs: { amount: "0", currency: "USDT" },         // free (read-only)
};

export interface FaucetRecord {
  claimedAt: number;
}

export interface BootstrapRecord {
  claimedAt: number;
  callCount: number;
}

export const BOOTSTRAP_LIMIT = 50;
export const FAUCET_AMOUNT = 100_000_000n; // 100 USDT0 (6 decimals)
