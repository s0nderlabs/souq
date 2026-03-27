// List Bids — Query existing bids on a job
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { originalFetch } from "../x402-fetch-patch.js";
import { getSouqApiUrl } from "../config.js";

const Schema = z.object({
  jobId: z.number().describe("The job ID to list bids for."),
});

interface BidInfo {
  type: string;
  bidder: string;
  proposedBudget: string;
  pitch: string;
  timestamp: number;
}

interface ListBidsResult {
  success: boolean;
  message: string;
  jobId?: number;
  bids?: BidInfo[];
  error?: string;
}

export function registerListBids(server: McpServer): void {
  server.tool(
    "list_bids",
    "List all bids and counter-offers on a job. Use before apply_for_job to see existing bids and price competitively.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<ListBidsResult> {
  try {
    const apiUrl = getSouqApiUrl();
    const res = await originalFetch(`${apiUrl}/relay/bids?jobId=${params.jobId}`);

    if (!res.ok) {
      return {
        success: false,
        message: `Failed to fetch bids: HTTP ${res.status}`,
        error: await res.text(),
      };
    }

    const data = (await res.json()) as {
      bids: Array<{
        type: string;
        jobId: number;
        from: string;
        bidder: string;
        proposedBudget: string;
        pitch: string;
        timestamp: number;
      }>;
    };

    const bids: BidInfo[] = data.bids.map((b) => ({
      type: b.type === "job:counter" ? "counter-offer" : "bid",
      bidder: b.bidder || b.from,
      proposedBudget: `${b.proposedBudget} USDT`,
      pitch: b.pitch || "",
      timestamp: b.timestamp,
    }));

    return {
      success: true,
      message: bids.length > 0
        ? `${bids.length} bid(s) on Job #${params.jobId}`
        : `No bids on Job #${params.jobId}`,
      jobId: params.jobId,
      bids,
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to list bids",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
