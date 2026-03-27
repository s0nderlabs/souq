import { Hono } from "hono";
import type { AppContext } from "../types";
import { getPinataGatewayUrl, getFallbackGateways } from "../config";

const ipfs = new Hono<AppContext>();

/**
 * POST /pin
 * Uploads JSON content to IPFS via Pinata's pinning API.
 * Uses raw fetch (PinataSDK is not compatible with Cloudflare Workers).
 *
 * Request body: any JSON (the deliverable or metadata to pin)
 * Response: { cid: string }
 */
ipfs.post("/pin", async (c) => {
  const json = await c.req.json();
  const blob = new Blob([JSON.stringify(json)], {
    type: "application/json",
  });

  const form = new FormData();
  form.append("file", blob, "payload.json");

  const pinataRes = await fetch(
    "https://api.pinata.cloud/pinning/pinFileToIPFS",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.PINATA_JWT}`,
      },
      body: form,
    }
  );

  if (!pinataRes.ok) {
    const errText = await pinataRes.text();
    return c.json(
      { error: "Pinata upload failed", detail: errText },
      pinataRes.status as 500
    );
  }

  const result = (await pinataRes.json()) as { IpfsHash: string };

  // Cache content in KV for instant retrieval (fire-and-forget — KV quota exhaustion is non-fatal)
  c.executionCtx.waitUntil(
    c.env.BOOTSTRAP_KV.put(`ipfs:${result.IpfsHash}`, JSON.stringify(json), {
      expirationTtl: 86400 * 7,
    }).catch(() => {})
  );

  return c.json({ cid: result.IpfsHash });
});

/**
 * Fetch from an IPFS gateway, parse as JSON, validate non-empty.
 * Returns null on any failure (HTTP error, empty response, parse error, network error).
 */
async function tryGateway(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const text = await response.text();
    if (!text || text === "{}" || text.length <= 2) return null; // propagation delay
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * GET /ipfs/:cid
 * Proxies IPFS content retrieval.
 * 1. Try Pinata gateway with JWT auth (fastest — same infra as pin)
 * 2. Fallback to public gateways on failure
 */
ipfs.get("/ipfs/:cid", async (c) => {
  const cid = c.req.param("cid");

  if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/i.test(cid)) {
    return c.json({ error: "Invalid CID format" }, 400);
  }

  // Check KV cache first (content cached at pin time — instant, no gateway needed)
  const cached = await c.env.BOOTSTRAP_KV.get(`ipfs:${cid}`);
  if (cached) {
    return c.json(JSON.parse(cached) as Record<string, unknown>);
  }

  // Fallback to IPFS gateways (for content pinned before KV caching was added)
  const pinataUrl = getPinataGatewayUrl(cid);
  const pinataResult = await tryGateway(pinataUrl);
  if (pinataResult) return c.json(pinataResult);

  for (const gatewayUrl of getFallbackGateways(cid)) {
    const result = await tryGateway(gatewayUrl);
    if (result) return c.json(result);
  }

  return c.json({ error: "IPFS content not available", cid }, 502);
});

export default ipfs;
