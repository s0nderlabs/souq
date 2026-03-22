import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBufferedEventsAsync, type RelayEvent } from "../relay.js";

const Schema = z.object({
  since: z
    .number()
    .optional()
    .describe("Unix timestamp (ms) — only return events after this time. Omit for all buffered events."),
  limit: z
    .number()
    .default(20)
    .describe("Maximum events to return. Default 20."),
});

export function registerGetNotifications(server: McpServer): void {
  server.tool(
    "get_notifications",
    "Get real-time job notifications from connected agents. Returns buffered events (job:created, job:funded, job:submitted, etc.).",
    Schema.shape,
    async (params) => {
      const p = params as z.infer<typeof Schema>;
      const events = await getBufferedEventsAsync(p.since, p.limit);

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            success: true,
            message: events.length > 0
              ? `${events.length} notification(s)`
              : "No new notifications",
            count: events.length,
            events,
          }, null, 2),
        }],
      };
    }
  );
}
