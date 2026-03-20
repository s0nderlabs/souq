import { keccak256, type Hex } from "viem";
import { getSouqApiUrl } from "./config.js";
import { x402Fetch } from "./x402-client.js";

// ── Pin JSON to IPFS (via backend, x402-paid) ──

export async function pinJson(data: unknown): Promise<{ cid: string; hash: Hex }> {
  const jsonStr = JSON.stringify(data);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const contentHash = keccak256(jsonBytes);

  const response = await x402Fetch("/pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: jsonStr,
  });

  if (!response.ok) {
    throw new Error(`Pin failed: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as { cid: string };

  console.error(`[souq] Pinned JSON to IPFS: ${result.cid}`);
  return { cid: result.cid, hash: contentHash };
}

// ── Pin File to IPFS (via backend, x402-paid) ──

export async function pinFile(
  content: Buffer | Uint8Array,
  filename: string
): Promise<{ cid: string; hash: Hex }> {
  const contentHash = keccak256(content);

  const response = await x402Fetch("/pin", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Filename": filename,
    },
    body: content,
  });

  if (!response.ok) {
    throw new Error(`Pin failed: ${response.status} ${response.statusText}`);
  }

  const result = (await response.json()) as { cid: string };

  console.error(`[souq] Pinned file to IPFS: ${result.cid}`);
  return { cid: result.cid, hash: contentHash };
}

// ── Fetch from IPFS (via backend, FREE) ──

const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|b[a-z2-7]{58,})$/;

export async function fetchFromIpfs(cid: string): Promise<Buffer> {
  if (!CID_REGEX.test(cid)) {
    throw new Error(`Invalid IPFS CID format: ${cid}`);
  }

  const apiUrl = getSouqApiUrl();

  // IPFS reads are free — no x402 payment needed
  const response = await fetch(`${apiUrl}/ipfs/${cid}`);
  if (!response.ok) {
    throw new Error(`IPFS fetch failed: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── CID to bytes32 (commitment hash for on-chain storage) ──

export function cidToBytes32(cid: string): Hex {
  const cidBytes = new TextEncoder().encode(cid);
  return keccak256(cidBytes);
}

// ── IPFS URI helpers ──

export function toIpfsUri(cid: string): string {
  return `ipfs://${cid}`;
}

export function fromIpfsUri(uri: string): string {
  if (uri.startsWith("ipfs://")) return uri.slice(7);
  return uri;
}
