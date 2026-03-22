import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData, formatUnits } from "viem";
import { sendTx, getPublicClient, waitForUserOp } from "../protocol.js";
import { ESCROW_ADDRESS, USDT_DECIMALS, explorerTxUrl } from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";

const Schema = z.object({
  jobId: z.number().describe("The job ID to claim a refund for"),
});

interface ClaimRefundResult {
  success: boolean;
  message: string;
  transaction?: {
    hash: string;
    explorerUrl: string;
  };
  refund?: {
    jobId: number;
    amount: string;
    status: string;
  };
  error?: string;
}

export function registerClaimRefund(server: McpServer): void {
  server.tool(
    "claim_refund",
    "Claim refund for an expired job. Anyone can call after expiry.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<ClaimRefundResult> {
  try {
    const publicClient = getPublicClient();

    // Read job to validate status before sending tx
    const job = await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "getJob",
      args: [BigInt(params.jobId)],
    }) as {
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

    const statusName = JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? `Unknown(${job.status})`;

    // Only Funded (1) or Submitted (2) jobs can be refunded
    if (job.status !== 1 && job.status !== 2) {
      return {
        success: false,
        message: `Job #${params.jobId} is in status "${statusName}" and cannot be refunded`,
        error: `Refund requires status Funded or Submitted, but job is ${statusName}`,
      };
    }

    const refundAmount = formatUnits(job.budget, USDT_DECIMALS);

    const data = encodeFunctionData({
      abi: escrowAbi,
      functionName: "claimRefund",
      args: [BigInt(params.jobId)],
    });

    const { hash } = await sendTx(ESCROW_ADDRESS, data);
    await waitForUserOp(hash);

    return {
      success: true,
      message: `Refund claimed for job #${params.jobId}: ${refundAmount} USDT`,
      transaction: {
        hash,
        explorerUrl: explorerTxUrl(hash),
      },
      refund: {
        jobId: params.jobId,
        amount: `${refundAmount} USDT`,
        status: statusName,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to claim refund",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
