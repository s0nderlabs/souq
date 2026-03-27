// Send Counter-Offer — Client sends a counter-offer to a bidder
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAddress, getPublicClient } from "../protocol.js";
import { ESCROW_ADDRESS } from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";
import { sendRelayEvent } from "../relay.js";

const Schema = z.object({
  jobId: z.number().describe("The job ID to send a counter-offer for."),
  to: z.string().describe("Wallet address of the bidder to counter."),
  proposedBudget: z
    .string()
    .describe("Your counter-offer budget in human-readable USDT (e.g. '5')."),
  message: z
    .string()
    .describe("Message explaining the counter-offer."),
});

interface CounterOfferResult {
  success: boolean;
  message: string;
  counterOffer?: {
    jobId: number;
    to: string;
    proposedBudget: string;
  };
  error?: string;
}

export function registerSendCounterOffer(server: McpServer): void {
  server.tool(
    "send_counter_offer",
    "Send a counter-offer to a bidder on your job. Only the client can counter-offer. Use list_bids to see existing bids first.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<CounterOfferResult> {
  try {
    const callerAddress = await getAddress();
    const publicClient = getPublicClient();

    const job = (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "getJob",
      args: [BigInt(params.jobId)],
    })) as {
      client: string;
      status: number;
    };

    if (job.client.toLowerCase() !== callerAddress.toLowerCase()) {
      return {
        success: false,
        message: "Only the job client can send counter-offers.",
        error: "Not the client",
      };
    }

    if (job.status !== 0) {
      return {
        success: false,
        message: `Job is not Open. Current status: ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`,
        error: "Can only counter-offer on Open jobs",
      };
    }

    sendRelayEvent({
      type: "job:counter",
      jobId: params.jobId,
      to: params.to.toLowerCase(),
      data: {
        proposedBudget: params.proposedBudget,
        message: params.message,
        from: callerAddress,
      },
    });

    return {
      success: true,
      message: `Counter-offer sent for Job #${params.jobId}: ${params.proposedBudget} USDT`,
      counterOffer: {
        jobId: params.jobId,
        to: params.to,
        proposedBudget: `${params.proposedBudget} USDT`,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to send counter-offer",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
