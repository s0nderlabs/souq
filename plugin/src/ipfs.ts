import { keccak256, type Hex } from "viem";
import { getSouqApiUrl } from "./config.js";
import { x402FetchRaw } from "./x402-client.js";
import { originalFetch } from "./x402-fetch-patch.js";

// ── Pin JSON to IPFS (via backend, x402-paid) ──

export async function pinJson(data: unknown): Promise<{ cid: string; hash: Hex }> {
  const jsonStr = JSON.stringify(data);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  const contentHash = keccak256(jsonBytes);

  const response = await x402FetchRaw("/pin", {
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

  const response = await x402FetchRaw("/pin", {
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

  // IPFS reads are free (no x402) — use originalFetch to avoid burning bootstrap calls.
  // Retry with backoff for: gateway errors, propagation delay (empty response).
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await originalFetch(`${apiUrl}/ipfs/${cid}`);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      const buf = Buffer.from(arrayBuffer);
      // Guard against IPFS propagation delay — gateway returns {} or empty before content replicates
      if (buf.length <= 2) {
        console.error(`[souq] IPFS propagation delay for ${cid} (attempt ${attempt + 1}/5)`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      return buf;
    }
    if (response.status === 502 || response.status === 429) {
      await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    throw new Error(`IPFS fetch failed: ${response.status} ${response.statusText}`);
  }
  throw new Error(`IPFS fetch failed after 5 attempts for ${cid}`);
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
