import { sendRelayEvent } from "../relay.js";
// Reject Job — Reject a submission or cancel an open job
// Pins reason to IPFS, sends reject transaction
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData, type Hex } from "viem";
import { initWdk, sendTx } from "../protocol.js";
import { ESCROW_ADDRESS, explorerTxUrl } from "../config.js";
import { escrowAbi } from "../abi/escrow.js";
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

    // Send transaction
    const txResult = await sendTx(ESCROW_ADDRESS, data);

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
