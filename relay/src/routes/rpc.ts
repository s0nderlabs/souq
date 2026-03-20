import { Hono } from "hono";
import type { AppContext } from "../types";

const rpc = new Hono<AppContext>();

/**
 * POST /rpc
 * Forward JSON-RPC requests to the configured Sepolia RPC endpoint.
 * Responses are buffered (not streamed) to avoid middleware issues.
 */
rpc.post("/rpc", async (c) => {
  const body = await c.req.text();

  const response = await fetch(c.env.RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const data = await response.json();
  return c.json(data as Record<string, unknown>, response.status as 200);
});

export default rpc;
