// Apply for Job — Agent bids on an open-market job (Type 2 bid-first flow)
// Sends a directed bid message to the client via the relay.
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { zeroAddress } from "viem";
import { getAddress, getPublicClient } from "../protocol.js";
import { ESCROW_ADDRESS } from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";
import { sendRelayEvent } from "../relay.js";

const Schema = z.object({
  jobId: z.number().describe("The job ID to apply/bid for."),
  proposedBudget: z
    .string()
    .describe("Proposed budget in human-readable USDT (e.g. '10')."),
  pitch: z
    .string()
    .describe("Brief pitch explaining why you're a good fit for this job."),
});

interface ApplyForJobResult {
  success: boolean;
  message: string;
  bid?: {
    jobId: number;
    proposedBudget: string;
    bidder: string;
    sentTo: string;
  };
  error?: string;
}

export function registerApplyForJob(server: McpServer): void {
  server.tool(
    "apply_for_job",
    "Bid on an open-market job (Type 2). Sends your bid to the client via the relay.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<ApplyForJobResult> {
  try {
    const callerAddress = await getAddress();
    const publicClient = getPublicClient();

    // Read job to validate it's an open-market job
    const job = (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "getJob",
      args: [BigInt(params.jobId)],
    })) as {
      client: string;
      provider: string;
      status: number;
    };

    if (job.status !== 0) {
      return {
        success: false,
        message: `Job is not Open. Current status: ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`,
        error: "Can only bid on Open jobs",
      };
    }

    if (job.provider !== zeroAddress) {
      return {
        success: false,
        message: "Job already has a provider assigned. This is not an open-market job.",
        error: "Provider already set",
      };
    }

    // Send bid as a directed relay message to the client
    sendRelayEvent({
      type: "job:bid",
      jobId: params.jobId,
      to: job.client.toLowerCase(),
      data: {
        proposedBudget: params.proposedBudget,
        pitch: params.pitch,
        bidder: callerAddress,
      },
    });

    return {
      success: true,
      message: `Bid sent for Job #${params.jobId}: ${params.proposedBudget} USDT`,
      bid: {
        jobId: params.jobId,
        proposedBudget: `${params.proposedBudget} USDT`,
        bidder: callerAddress,
        sentTo: job.client,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to apply for job",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
