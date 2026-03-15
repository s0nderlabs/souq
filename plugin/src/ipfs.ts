import { PinataSDK } from "pinata";
import { keccak256, toHex, type Hex } from "viem";
import { getPinataJwt, IPFS_GATEWAY } from "./config.js";

// ── Lazy Pinata Client ──

let pinataClient: PinataSDK | null = null;

function getPinata(): PinataSDK {
  if (!pinataClient) {
    pinataClient = new PinataSDK({ pinataJwt: getPinataJwt() });
  }
  return pinataClient;
}

// ── Pin JSON to IPFS ──

export async function pinJson(data: unknown): Promise<{ cid: string; hash: Hex }> {
  const jsonStr = JSON.stringify(data);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const contentHash = keccak256(jsonBytes);

  const pinata = getPinata();
  const file = new File([jsonBytes], "data.json", { type: "application/json" });
  const result = await pinata.upload.public.file(file);

  console.error(`[souq] Pinned JSON to IPFS: ${result.cid}`);
  return { cid: result.cid, hash: contentHash };
}

// ── Pin File to IPFS ──

export async function pinFile(
  content: Buffer | Uint8Array,
  filename: string
): Promise<{ cid: string; hash: Hex }> {
  const contentHash = keccak256(content);

  const pinata = getPinata();
  const file = new File([content], filename, { type: "application/octet-stream" });
  const result = await pinata.upload.public.file(file);

  console.error(`[souq] Pinned file to IPFS: ${result.cid}`);
  return { cid: result.cid, hash: contentHash };
}

// ── Fetch from IPFS ──

const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44,}|b[a-z2-7]{58,})$/;

export async function fetchFromIpfs(cid: string): Promise<Buffer> {
  if (!CID_REGEX.test(cid)) {
    throw new Error(`Invalid IPFS CID format: ${cid}`);
  }
  const url = `${IPFS_GATEWAY}${cid}`;
  const response = await fetch(url);
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
