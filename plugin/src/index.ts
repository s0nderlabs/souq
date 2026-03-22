#!/usr/bin/env node
import "dotenv/config";
import { patchFetchForX402 } from "./x402-fetch-patch.js";

// Patch global fetch BEFORE any WDK initialization — intercepts WDK's bundler calls
patchFetchForX402();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";
import { initWdk, getAddress } from "./protocol.js";
import { connectRelay, onRelayEvent, sendRelayEvent } from "./relay.js";

// Declare logging capability so we can push notifications to the AI agent
export const server = new McpServer(
  { name: "souq", version: "1.0.0" },
  { capabilities: { logging: {} } }
);
registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Souq MCP server running on stdio");

  // Push relay events to the AI agent via MCP logging notifications
  onRelayEvent((event) => {
    const msg = event.type === "job:created"
      ? `New job #${event.jobId}: ${(event.data as Record<string, string>)?.description || "no description"}`
      : `Job #${event.jobId}: ${event.type.replace("job:", "")}`;

    server.sendLoggingMessage({
      level: "info",
      logger: "souq",
      data: msg,
    }).catch(() => {}); // non-fatal if transport disconnected
  });

  // Connect to relay in background and broadcast pubkey (non-blocking, non-fatal)
  initWdk()
    .then(async () => {
      const addr = await getAddress();
      connectRelay(addr);
      // Broadcast pubkey so other agents can auto-discover it
      const { getSeedPhrase } = await import("./config.js");
      const { deriveKeypairFromSeed } = await import("./encryption.js");
      const { bytesToHex } = await import("viem");
      const keypair = deriveKeypairFromSeed(getSeedPhrase());
      sendRelayEvent({ type: "agent:ready", data: { address: addr, encryptionPublicKey: bytesToHex(keypair.publicKey) } });
    })
    .catch(() => console.error("[souq] Relay connection deferred (wallet not ready)"));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
