// Get Job — Read job details from the escrow contract (view only, no tx)
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatUnits, zeroAddress } from "viem";
import { getPublicClient } from "../protocol.js";
import { ESCROW_ADDRESS, USDT_DECIMALS } from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";

const GetJobSchema = z.object({
  jobId: z.number().describe("The job ID to look up."),
});

interface GetJobResult {
  success: boolean;
  message: string;
  job?: {
    jobId: number;
    status: string;
    statusCode: number;
    client: string;
    provider: string;
    evaluator: string;
    budget: string;
    budgetRaw: string;
    expiresAt: string;
    isExpired: boolean;
    description: string;
    deliverable: string;
    hook: string;
    hasHook: boolean;
  };
  error?: string;
}

export function registerGetJob(server: McpServer): void {
  server.tool(
    "get_job",
    "Read job details from the escrow contract.",
    GetJobSchema.shape,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result = await getJobHandler(params as z.infer<typeof GetJobSchema>);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}

async function getJobHandler(
  params: z.infer<typeof GetJobSchema>
): Promise<GetJobResult> {
  try {
    const publicClient = getPublicClient();

    // Read job from contract
    const job = (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "getJob",
      args: [BigInt(params.jobId)],
    })) as {
      client: string;
      provider: string;
      evaluator: string;
      budget: bigint;
      expiredAt: bigint;
      description: string;
      deliverable: string;
      hook: string;
      status: number;
    };

    // Check if job exists (client is zero address for non-existent jobs)
    if (job.client === zeroAddress) {
      return {
        success: false,
        message: `Job #${params.jobId} not found`,
        error: "Job does not exist or has not been created",
      };
    }

    // Format fields
    const statusName =
      JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? `Unknown(${job.status})`;
    const budgetFormatted = formatUnits(job.budget, USDT_DECIMALS);
    const expiresAtDate = new Date(Number(job.expiredAt) * 1000);
    const isExpired = Date.now() > expiresAtDate.getTime();
    const hasHook = job.hook !== zeroAddress;

    return {
      success: true,
      message: `Job #${params.jobId}: ${statusName}`,
      job: {
        jobId: params.jobId,
        status: statusName,
        statusCode: job.status,
        client: job.client,
        provider: job.provider,
        evaluator: job.evaluator,
        budget: `${budgetFormatted} USDT`,
        budgetRaw: job.budget.toString(),
        expiresAt: expiresAtDate.toISOString(),
        isExpired,
        description: job.description,
        deliverable: job.deliverable,
        hook: job.hook,
        hasHook,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to read job",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
