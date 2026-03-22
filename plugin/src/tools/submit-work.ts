import { sendRelayEvent } from "../relay.js";
// Submit Work — Encrypt deliverable for evaluator, pin to IPFS, submit on-chain
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData, hexToBytes, type Hex } from "viem";
import { getAddress, sendTx, getPublicClient } from "../protocol.js";
import { ESCROW_ADDRESS, explorerTxUrl } from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";
import { pinJson, cidToBytes32, toIpfsUri } from "../ipfs.js";
import { encrypt } from "../encryption.js";
import { findPubkeyByAddress } from "../relay.js";

const SubmitWorkSchema = z.object({
  jobId: z.number().describe("The job ID to submit work for."),
  deliverable: z
    .string()
    .describe("The work content/deliverable to submit. Will be encrypted for the evaluator."),
  evaluatorPublicKey: z
    .string()
    .optional()
    .describe(
      "Hex-encoded uncompressed public key of the evaluator for encryption (65 bytes, 0x04 prefix). Auto-detected from notifications if omitted."
    ),
});

interface SubmitWorkResult {
  success: boolean;
  message: string;
  submission?: {
    jobId: number;
    deliverableCid: string;
    deliverableUri: string;
    txHash: string;
    explorerUrl: string;
    encrypted: boolean;
  };
  error?: string;
}

export function registerSubmitWork(server: McpServer): void {
  server.tool(
    "submit_work",
    "Submit work deliverable. Encrypts for evaluator and pins to IPFS.",
    SubmitWorkSchema.shape,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result = await submitWorkHandler(params as z.infer<typeof SubmitWorkSchema>);
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

async function submitWorkHandler(
  params: z.infer<typeof SubmitWorkSchema>
): Promise<SubmitWorkResult> {
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

    // Validate status is Funded (1)
    if (job.status !== 1) {
      return {
        success: false,
        message: `Job is not Funded. Current status: ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`,
        error: `Cannot submit work for a job with status ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`,
      };
    }

    // Validate caller is the provider
    if (callerAddress.toLowerCase() !== job.provider.toLowerCase()) {
      return {
        success: false,
        message: "Only the assigned provider can submit work",
        error: `Caller ${callerAddress} is not the provider ${job.provider}`,
      };
    }

    // Resolve evaluator public key (from param or auto-discover from notifications)
    let evaluatorPubKey: string | undefined = params.evaluatorPublicKey;
    if (!evaluatorPubKey) {
      evaluatorPubKey = findPubkeyByAddress(job.evaluator) || undefined;
      if (!evaluatorPubKey) {
        return {
          success: false,
          message: "Evaluator's encryption public key not found. Either pass evaluatorPublicKey or ensure the evaluator has called setup_wallet.",
        };
      }
      console.error(`[souq] Auto-discovered evaluator pubkey from notifications`);
    }

    // Encrypt deliverable for evaluator
    const evaluatorPubKeyBytes = hexToBytes(
      evaluatorPubKey as `0x${string}`
    );
    const deliverableBuffer = Buffer.from(params.deliverable, "utf-8");
    const encryptedPackage = await encrypt(deliverableBuffer, evaluatorPubKeyBytes);

    // Pin encrypted package to IPFS
    const encryptedPayload = {
      type: "encrypted_deliverable",
      jobId: params.jobId,
      provider: callerAddress,
      encryptedFor: "evaluator",
      package: encryptedPackage,
      submittedAt: new Date().toISOString(),
    };
    const { cid: deliverableCid } = await pinJson(encryptedPayload);
    const deliverableHash = cidToBytes32(deliverableCid);

    // Encode submit(jobId, deliverableHash, optParams)
    const data = encodeFunctionData({
      abi: escrowAbi,
      functionName: "submit",
      args: [BigInt(params.jobId), deliverableHash, "0x" as Hex],
    });

    // Send transaction
    const txResult = await sendTx(ESCROW_ADDRESS, data);

    sendRelayEvent({ type: "job:submitted", jobId: params.jobId, data: { deliverableCid, txHash: txResult.hash } });

    return {
      success: true,
      message: `Work submitted for Job #${params.jobId}`,
      submission: {
        jobId: params.jobId,
        deliverableCid,
        deliverableUri: toIpfsUri(deliverableCid),
        txHash: txResult.hash,
        explorerUrl: explorerTxUrl(txResult.hash),
        encrypted: true,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to submit work",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
