import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppContext } from "./types";
import { ROUTE_PRICING } from "./types";
import { x402Middleware } from "./middleware/x402";
import { bootstrapMiddleware } from "./middleware/bootstrap";
import { deploymentExemptMiddleware } from "./middleware/deployment-exempt";
import facilitatorRoutes from "./facilitator/routes";
import rpcRoutes from "./routes/rpc";
import bundlerRoutes from "./routes/bundler";
import ipfsRoutes from "./routes/ipfs";
import faucetRoutes from "./routes/faucet";
import sigilRoutes from "./routes/sigil";

const app = new Hono<AppContext>();

// CORS for all routes
app.use("/*", cors());

// Health check (public)
app.get("/", (c) =>
  c.json({
    status: "ok",
    service: "souq-api",
    version: "1.0.0",
  })
);

// Pricing info (public)
app.get("/pricing", (c) =>
  c.json({
    routes: ROUTE_PRICING,
    faucet: { amount: "100 USDT", onePerAddress: true },
    payment: {
      method: "x402",
      description: "Payments via x402 protocol (EIP-3009 TransferWithAuthorization)",
      treasury: c.env.TREASURY_ADDRESS,
    },
  })
);

// Facilitator discovery (public)
app.route("/", facilitatorRoutes);

// Faucet (public, rate-limited by KV)
app.route("/", faucetRoutes);

// Payment middleware chain (order matters):
// 1. Bootstrap — check free tier first (N free calls after faucet claim)
// 2. Deployment-exempt — Safe deployment + read-only bundler calls always free
// 3. x402 — handle payment via EIP-3009 TransferWithAuthorization
app.use("/rpc", bootstrapMiddleware);
app.use("/bundler", bootstrapMiddleware);
app.use("/pin", bootstrapMiddleware);
app.use("/bundler", deploymentExemptMiddleware);
app.use("/rpc", x402Middleware);
app.use("/bundler", x402Middleware);
app.use("/pin", x402Middleware);

app.route("/", rpcRoutes);
app.route("/", bundlerRoutes);
app.route("/", ipfsRoutes);
app.route("/", sigilRoutes);

// WebSocket relay + event history + job metadata
app.get("/relay", async (c) => {
  const stub = c.env.RELAY.get(c.env.RELAY.idFromName("souq-relay"));
  return stub.fetch(c.req.raw);
});
app.get("/relay/events", async (c) => {
  const stub = c.env.RELAY.get(c.env.RELAY.idFromName("souq-relay"));
  return stub.fetch(c.req.raw);
});
app.get("/relay/jobs", async (c) => {
  const stub = c.env.RELAY.get(c.env.RELAY.idFromName("souq-relay"));
  return stub.fetch(c.req.raw);
});
app.get("/relay/jobs/:id", async (c) => {
  const stub = c.env.RELAY.get(c.env.RELAY.idFromName("souq-relay"));
  const id = c.req.param("id");
  const rewritten = new Request(new URL(`/relay/jobs/${id}`, c.req.url), c.req.raw);
  return stub.fetch(rewritten);
});
app.get("/relay/bids", async (c) => {
  const stub = c.env.RELAY.get(c.env.RELAY.idFromName("souq-relay"));
  return stub.fetch(c.req.raw);
});
app.get("/relay/agents", async (c) => {
  const stub = c.env.RELAY.get(c.env.RELAY.idFromName("souq-relay"));
  return stub.fetch(c.req.raw);
});

// POST /relay/events — guaranteed event persistence
app.post("/relay/events", async (c) => {
  const stub = c.env.RELAY.get(c.env.RELAY.idFromName("souq-relay"));
  return stub.fetch(c.req.raw);
});

export default { fetch: app.fetch };
export { SouqRelay } from "./relay/ws";
