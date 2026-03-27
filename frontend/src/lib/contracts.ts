import type { Address } from "viem";

export const ESCROW_ADDRESS: Address = "0x2AE839f237187102713c8c05736fda65430B17f0";
export const USDT_ADDRESS: Address = "0xABfd273ef83Ed85DBe776E4311118c3F2da27469";
export const IDENTITY_REGISTRY: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
export const REPUTATION_REGISTRY: Address = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
export const USDT_DECIMALS = 6;

export const API_URL = process.env.NEXT_PUBLIC_SOUQ_API_URL || "https://api.souq.s0nderlabs.xyz";

export const JOB_STATUS: Record<number, string> = {
  0: "Open",
  1: "Funded",
  2: "Submitted",
  3: "Completed",
  4: "Rejected",
  5: "Expired",
};

export const TERMINAL_STATUSES = new Set(["completed", "rejected", "expired"]);

/** Parse the raw `getJob` return (tuple or object) into a lowercase status string. */
export function parseOnChainJobStatus(jobResult: unknown): string {
  const raw = jobResult as readonly unknown[];
  const statusVal = Array.isArray(raw)
    ? Number(raw[8])
    : Number((jobResult as Record<string, unknown>).status ?? 0);
  return JOB_STATUS[statusVal]?.toLowerCase() || "open";
}

export const escrowAbi = [
  { type: "function", name: "getJob", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "description", type: "bytes32" }, { name: "deliverable", type: "bytes32" }, { name: "hook", type: "address" }, { name: "status", type: "uint8" }], stateMutability: "view" },
  { type: "function", name: "jobCount", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "platformFeeBP", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "evaluatorFeeBP", inputs: [], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "createJob", inputs: [{ name: "provider_", type: "address" }, { name: "evaluator_", type: "address" }, { name: "expiredAt_", type: "uint256" }, { name: "description_", type: "bytes32" }, { name: "hook_", type: "address" }, { name: "optParams", type: "bytes" }], outputs: [{ name: "jobId", type: "uint256" }], stateMutability: "nonpayable" },
  { type: "function", name: "setProvider", inputs: [{ name: "jobId", type: "uint256" }, { name: "provider_", type: "address" }, { name: "optParams", type: "bytes" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "setBudget", inputs: [{ name: "jobId", type: "uint256" }, { name: "amount_", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "fund", inputs: [{ name: "jobId", type: "uint256" }, { name: "expectedBudget_", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [], stateMutability: "nonpayable" },
  { type: "event", name: "JobCreated", inputs: [{ name: "jobId", type: "uint256", indexed: true }, { name: "client", type: "address", indexed: true }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "expiredAt", type: "uint256" }, { name: "hook", type: "address" }] },
] as const;

export const usdtAbi = [
  { type: "function", name: "approve", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }], stateMutability: "nonpayable" },
  { type: "function", name: "balanceOf", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "allowance", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "mint", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
] as const;

export const identityAbi = [
  { type: "function", name: "balanceOf", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "ownerOf", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
  { type: "function", name: "tokenOfOwnerByIndex", inputs: [{ name: "owner", type: "address" }, { name: "index", type: "uint256" }], outputs: [{ name: "", type: "uint256" }], stateMutability: "view" },
  { type: "function", name: "tokenURI", inputs: [{ name: "tokenId", type: "uint256" }], outputs: [{ name: "", type: "string" }], stateMutability: "view" },
  { type: "function", name: "getAgentWallet", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "", type: "address" }], stateMutability: "view" },
] as const;

export const reputationAbi = [
  { type: "function", name: "getSummary", inputs: [{ name: "agentId", type: "uint256" }, { name: "validators", type: "address[]" }, { name: "tag", type: "string" }], outputs: [{ name: "total", type: "int256" }, { name: "count", type: "uint256" }], stateMutability: "view" },
] as const;
