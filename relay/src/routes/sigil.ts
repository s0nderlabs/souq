import { Hono } from "hono";
import type { AppContext } from "../types";

const sigil = new Hono<AppContext>();

/**
 * POST /sigil/inscribe
 * Single-shot policy creation via Sigil Scribe AI.
 * Injects API key auth. Returns JSON (not SSE stream).
 */
sigil.post("/sigil/inscribe", async (c) => {
  const body = await c.req.json();
  const walletAddress = c.req.header("X-SOUQ-WALLET") || "";

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (c.env.SIGIL_API_KEY) {
    headers["Authorization"] = `Bearer ${c.env.SIGIL_API_KEY}`;
    headers["x-wallet-address"] = walletAddress;
  }

  const response = await fetch(`${c.env.SIGIL_SERVER_URL}/inscribe/auto`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return c.json(data as Record<string, unknown>, response.status as 200);
});

/**
 * POST /sigil/assess
 * Proxies compliance assessment trigger to the Sigil server.
 * No auth injection — the request body contains a signed message (EIP-191).
 */
sigil.post("/sigil/assess", async (c) => {
  const body = await c.req.text();

  const response = await fetch(`${c.env.SIGIL_SERVER_URL}/trigger-assessment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await response.json();
  return c.json(data as Record<string, unknown>, response.status as 200);
});

/**
 * GET /sigil/assessments
 * Proxies assessment history lookup. No auth needed.
 * Query params: ?wallet=0x... or ?agentId=123
 */
sigil.get("/sigil/assessments", async (c) => {
  const url = new URL(`${c.env.SIGIL_SERVER_URL}/assessments`);
  const wallet = c.req.query("wallet");
  const agentId = c.req.query("agentId");
  if (wallet) url.searchParams.set("wallet", wallet);
  if (agentId) url.searchParams.set("agentId", agentId);

  const response = await fetch(url.toString());
  const data = await response.json();
  return c.json(data as Record<string, unknown>, response.status as 200);
});

export default sigil;
