import { Hono } from "hono";
import type { AppContext } from "../types";

const sigil = new Hono<AppContext>();

/**
 * POST /sigil/inscribe
 * Proxies policy creation to the Sigil Scribe AI.
 * Injects API key auth so agents don't need Sigil credentials.
 * Response is SSE stream — must be forwarded without buffering.
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

  const response = await fetch(`${c.env.SIGIL_SERVER_URL}/inscribe`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  // Stream SSE response back verbatim — do NOT buffer
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
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

export default sigil;
