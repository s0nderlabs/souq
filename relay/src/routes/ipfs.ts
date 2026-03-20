import { Hono } from "hono";
import type { AppContext } from "../types";
import { getIpfsGateway } from "../config";

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
  return c.json({ cid: result.IpfsHash });
});

/**
 * GET /ipfs/:cid
 * Proxies IPFS content retrieval through Pinata's gateway.
 * CID format is validated before proxying.
 */
ipfs.get("/ipfs/:cid", async (c) => {
  const cid = c.req.param("cid");

  // Basic CID format validation (CIDv0 starts with Qm, CIDv1 starts with b)
  if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/i.test(cid)) {
    return c.json({ error: "Invalid CID format" }, 400);
  }

  const gatewayUrl = getIpfsGateway(cid);
  const response = await fetch(gatewayUrl);

  if (!response.ok) {
    return c.json(
      { error: "IPFS fetch failed", status: response.status },
      response.status as 404
    );
  }

  const data = await response.json();
  return c.json(data as Record<string, unknown>);
});

export default ipfs;
