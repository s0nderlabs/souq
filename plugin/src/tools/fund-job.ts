import { sendRelayEvent } from "../relay.js";
// Fund Job — Approve USDT + lock in escrow via batched transaction
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData, formatUnits, type Hex } from "viem";
import { getAddress, batchTx, getPublicClient } from "../protocol.js";
import {
  ESCROW_ADDRESS,
  USDT_ADDRESS,
  USDT_DECIMALS,
  explorerTxUrl,
} from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";
import { usdtAbi } from "../abi/usdt.js";

const FundJobSchema = z.object({
  jobId: z.number().describe("The job ID to fund."),
});

interface FundJobResult {
  success: boolean;
  message: string;
  funding?: {
    jobId: number;
    budget: string;
    budgetRaw: string;
    txHash: string;
    explorerUrl: string;
  };
  error?: string;
}

export function registerFundJob(server: McpServer): void {
  server.tool(
    "fund_job",
    "Fund a job by approving USDT and locking it in escrow. Batches approve + fund in one transaction.",
    FundJobSchema.shape,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result = await fundJobHandler(params as z.infer<typeof FundJobSchema>);
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

async function fundJobHandler(
  params: z.infer<typeof FundJobSchema>
): Promise<FundJobResult> {
  try {
    const callerAddress = await getAddress();
    const publicClient = getPublicClient();

    // Read job details
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

    // Validate status is Open (0)
    if (job.status !== 0) {
      return {
        success: false,
        message: `Job is not Open. Current status: ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`,
        error: `Cannot fund a job with status ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`,
      };
    }

    // Validate budget is set (retry once after 3s for RPC propagation lag after set_budget)
    let budget = job.budget;
    if (budget === 0n) {
      console.error("[souq] Budget reads 0 — waiting 3s for RPC propagation...");
      await new Promise(r => setTimeout(r, 3000));
      const retryJob = await publicClient.readContract({
        address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "getJob", args: [BigInt(params.jobId)],
      }) as { budget: bigint; status: number; provider: string; client: string };
      budget = retryJob.budget;
      if (budget === 0n) {
        return {
          success: false,
          message: "Job budget is zero. Set a budget before funding.",
          error: "Budget must be greater than zero to fund",
        };
      }
      console.error(`[souq] Budget propagated on retry: ${budget}`);
    }

    // Check caller USDT balance
    const usdtBalance = (await publicClient.readContract({
      address: USDT_ADDRESS,
      abi: usdtAbi,
      functionName: "balanceOf",
      args: [callerAddress],
    })) as bigint;

    if (usdtBalance < budget) {
      return {
        success: false,
        message: `Insufficient USDT balance. Need ${formatUnits(budget, USDT_DECIMALS)}, have ${formatUnits(usdtBalance, USDT_DECIMALS)}`,
        error: "Insufficient USDT balance",
      };
    }

    // Encode approve(escrow, budget)
    const approveData = encodeFunctionData({
      abi: usdtAbi,
      functionName: "approve",
      args: [ESCROW_ADDRESS, budget],
    });

    // Encode fund(jobId, expectedBudget, optParams)
    const fundData = encodeFunctionData({
      abi: escrowAbi,
      functionName: "fund",
      args: [BigInt(params.jobId), budget, "0x" as Hex],
    });

    // Batch approve + fund in a single UserOperation
    const txResult = await batchTx([
      { to: USDT_ADDRESS, data: approveData },
      { to: ESCROW_ADDRESS, data: fundData },
    ]);

    const budgetFormatted = formatUnits(budget, USDT_DECIMALS);

    sendRelayEvent({ type: "job:funded", jobId: params.jobId, data: { budget: budgetFormatted, txHash: txResult.hash } });

    return {
      success: true,
      message: `Job #${params.jobId} funded with ${budgetFormatted} USDT`,
      funding: {
        jobId: params.jobId,
        budget: `${budgetFormatted} USDT`,
        budgetRaw: budget.toString(),
        txHash: txResult.hash,
        explorerUrl: explorerTxUrl(txResult.hash),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to fund job",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
