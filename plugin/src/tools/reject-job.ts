import { sendRelayEvent } from "../relay.js";
// Reject Job — Reject a submission or cancel an open job
// Pins reason to IPFS, sends reject transaction
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData, type Hex } from "viem";
import { initWdk, sendTx, getAddress, getPublicClient, waitForUserOp } from "../protocol.js";
import { ESCROW_ADDRESS, explorerTxUrl } from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";
import { pinJson, cidToBytes32, toIpfsUri } from "../ipfs.js";

const RejectJobSchema = z.object({
  jobId: z.number().describe("The job ID to reject or cancel."),
  reason: z
    .string()
    .describe("Reason for rejection. Will be pinned to IPFS."),
});

interface RejectJobResult {
  success: boolean;
  message: string;
  rejection?: {
    jobId: number;
    reasonCid: string;
    reasonUri: string;
    txHash: string;
    explorerUrl: string;
  };
  error?: string;
}

export function registerRejectJob(server: McpServer): void {
  server.tool(
    "reject_job",
    "Reject a job submission or cancel an open job.",
    RejectJobSchema.shape,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result = await rejectJobHandler(params as z.infer<typeof RejectJobSchema>);
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

async function rejectJobHandler(
  params: z.infer<typeof RejectJobSchema>
): Promise<RejectJobResult> {
  try {
    await initWdk();
    const callerAddress = await getAddress();
    const publicClient = getPublicClient();

    // Pre-validate: read job and check caller role + status before wasting IPFS pin cost
    const job = (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "getJob",
      args: [BigInt(params.jobId)],
    })) as { client: string; evaluator: string; status: number };

    if (job.status === 0) {
      // Open — only client can cancel
      if (callerAddress.toLowerCase() !== job.client.toLowerCase()) {
        return { success: false, message: "Only the client can cancel an Open job", error: `Caller ${callerAddress} is not the client ${job.client}` };
      }
    } else if (job.status === 1 || job.status === 2) {
      // Funded or Submitted — only evaluator can reject
      if (callerAddress.toLowerCase() !== job.evaluator.toLowerCase()) {
        return { success: false, message: "Only the evaluator can reject a Funded/Submitted job", error: `Caller ${callerAddress} is not the evaluator ${job.evaluator}` };
      }
    } else {
      return { success: false, message: `Job cannot be rejected. Current status: ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`, error: "Invalid status for rejection" };
    }

    // Pin rejection reason to IPFS
    const reasonPayload = {
      type: "rejection_reason",
      jobId: params.jobId,
      reason: params.reason,
      rejectedAt: new Date().toISOString(),
    };
    const { cid: reasonCid } = await pinJson(reasonPayload);
    const reasonHash = cidToBytes32(reasonCid);

    // Encode reject(jobId, reasonHash, optParams)
    const data = encodeFunctionData({
      abi: escrowAbi,
      functionName: "reject",
      args: [BigInt(params.jobId), reasonHash, "0x" as Hex],
    });

    // Send transaction and wait for on-chain confirmation
    const txResult = await sendTx(ESCROW_ADDRESS, data);
    await waitForUserOp(txResult.hash);

    sendRelayEvent({ type: "job:rejected", jobId: params.jobId, data: { reasonCid, txHash: txResult.hash } });

    return {
      success: true,
      message: `Job #${params.jobId} rejected`,
      rejection: {
        jobId: params.jobId,
        reasonCid,
        reasonUri: toIpfsUri(reasonCid),
        txHash: txResult.hash,
        explorerUrl: explorerTxUrl(txResult.hash),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to reject job",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
