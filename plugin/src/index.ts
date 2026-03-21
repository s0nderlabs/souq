#!/usr/bin/env node
import "dotenv/config";
import { patchFetchForX402 } from "./x402-fetch-patch.js";

// Patch global fetch BEFORE any WDK initialization — intercepts WDK's bundler calls
patchFetchForX402();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index.js";
import { initWdk, getAddress } from "./protocol.js";
import { connectRelay } from "./relay.js";

const server = new McpServer({ name: "souq", version: "1.0.0" });
registerTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Souq MCP server running on stdio");

  // Connect to relay in background (non-blocking, non-fatal)
  initWdk()
    .then(() => getAddress())
    .then((addr) => connectRelay(addr))
    .catch(() => console.error("[souq] Relay connection deferred (wallet not ready)"));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
