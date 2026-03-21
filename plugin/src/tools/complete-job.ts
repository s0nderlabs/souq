import { sendRelayEvent } from "../relay.js";
// Complete Job — Evaluator approves work, re-encrypts deliverable for client, releases payment
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData, formatUnits, hexToBytes, type Hex } from "viem";
import { getAddress, sendTx, getPublicClient } from "../protocol.js";
import { ESCROW_ADDRESS, USDT_DECIMALS, explorerTxUrl, getSeedPhrase } from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";
import {
  pinJson,
  fetchFromIpfs,
  cidToBytes32,
  toIpfsUri,
} from "../ipfs.js";
import {
  decrypt,
  reEncryptKey,
  deriveKeypairFromSeed,
  type EncryptedPackage,
} from "../encryption.js";

const CompleteJobSchema = z.object({
  jobId: z.number().describe("The job ID to complete/approve."),
  reason: z
    .string()
    .describe("Evaluation notes explaining the approval decision."),
  clientPublicKey: z
    .string()
    .describe(
      "Hex-encoded uncompressed public key of the client for deliverable re-encryption (65 bytes, 0x04 prefix)."
    ),
  deliverableCid: z
    .string()
    .describe("IPFS CID of the encrypted deliverable submitted by the provider."),
});

interface CompleteJobResult {
  success: boolean;
  message: string;
  completion?: {
    jobId: number;
    txHash: string;
    explorerUrl: string;
    reasonCid: string;
    clientDeliverableCid: string;
    clientDeliverableUri: string;
    payouts: {
      provider: string;
      evaluator: string;
      platform: string;
      total: string;
    };
  };
  error?: string;
}

export function registerCompleteJob(server: McpServer): void {
  server.tool(
    "complete_job",
    "Approve submitted work, release payment to provider. Evaluator only.",
    CompleteJobSchema.shape,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result = await completeJobHandler(params as z.infer<typeof CompleteJobSchema>);
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

async function completeJobHandler(
  params: z.infer<typeof CompleteJobSchema>
): Promise<CompleteJobResult> {
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

    // Validate status is Submitted (2)
    if (job.status !== 2) {
      return {
        success: false,
        message: `Job is not Submitted. Current status: ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`,
        error: `Cannot complete a job with status ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`,
      };
    }

    // Validate caller is the evaluator
    if (callerAddress.toLowerCase() !== job.evaluator.toLowerCase()) {
      return {
        success: false,
        message: "Only the evaluator can complete a job",
        error: `Caller ${callerAddress} is not the evaluator ${job.evaluator}`,
      };
    }

    // Fetch encrypted deliverable from IPFS
    const encryptedData = await fetchFromIpfs(params.deliverableCid);
    const encryptedPayload = JSON.parse(encryptedData.toString("utf-8")) as {
      package: EncryptedPackage;
    };
    const encryptedPackage = encryptedPayload.package;

    // Derive evaluator's keypair to decrypt
    const seedPhrase = getSeedPhrase();
    const evaluatorKeypair = deriveKeypairFromSeed(seedPhrase);

    // Decrypt the deliverable (verify it's valid)
    const decryptedContent = decrypt(encryptedPackage, evaluatorKeypair.privateKey);
    console.error(
      `[souq] Deliverable decrypted successfully (${decryptedContent.length} bytes)`
    );

    // Pin evaluation evidence to IPFS
    const evidencePayload = {
      type: "evaluation_evidence",
      jobId: params.jobId,
      evaluator: callerAddress,
      decision: "approved",
      reason: params.reason,
      deliverableCid: params.deliverableCid,
      evaluatedAt: new Date().toISOString(),
    };
    const { cid: reasonCid } = await pinJson(evidencePayload);
    const reasonHash = cidToBytes32(reasonCid);

    // Re-encrypt deliverable for the client
    const clientPubKeyBytes = hexToBytes(
      params.clientPublicKey as `0x${string}`
    );
    const reEncryptedKey = await reEncryptKey(
      encryptedPackage,
      evaluatorKeypair.privateKey,
      clientPubKeyBytes
    );

    // Build client-accessible encrypted package (same encrypted content, new key wrapping)
    const clientPackage: EncryptedPackage = {
      iv: encryptedPackage.iv,
      encryptedContent: encryptedPackage.encryptedContent,
      encryptedKey: reEncryptedKey.encryptedKey,
      ephemeralPublicKey: reEncryptedKey.ephemeralPublicKey,
    };

    // Pin re-encrypted deliverable for client
    const clientPayload = {
      type: "encrypted_deliverable",
      jobId: params.jobId,
      encryptedFor: "client",
      package: clientPackage,
      reEncryptedAt: new Date().toISOString(),
    };
    const { cid: clientDeliverableCid } = await pinJson(clientPayload);

    // Encode complete(jobId, reasonHash, optParams)
    const data = encodeFunctionData({
      abi: escrowAbi,
      functionName: "complete",
      args: [BigInt(params.jobId), reasonHash, "0x" as Hex],
    });

    // Send transaction
    const txResult = await sendTx(ESCROW_ADDRESS, data);

    // Read fee basis points for payout calculation
    const [platformFeeBP, evaluatorFeeBP] = await Promise.all([
      publicClient.readContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "platformFeeBP",
      }) as Promise<bigint>,
      publicClient.readContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "evaluatorFeeBP",
      }) as Promise<bigint>,
    ]);

    const budget = job.budget;
    const BPS_DENOMINATOR = 10_000n;
    const platformFee = (budget * platformFeeBP) / BPS_DENOMINATOR;
    const evaluatorFee = (budget * evaluatorFeeBP) / BPS_DENOMINATOR;
    const providerPayout = budget - platformFee - evaluatorFee;

    sendRelayEvent({ type: "job:completed", jobId: params.jobId, data: { txHash: txResult.hash, providerPayout: formatUnits(providerPayout, USDT_DECIMALS) } });

    return {
      success: true,
      message: `Job #${params.jobId} completed. Payment released.`,
      completion: {
        jobId: params.jobId,
        txHash: txResult.hash,
        explorerUrl: explorerTxUrl(txResult.hash),
        reasonCid,
        clientDeliverableCid,
        clientDeliverableUri: toIpfsUri(clientDeliverableCid),
        payouts: {
          provider: `${formatUnits(providerPayout, USDT_DECIMALS)} USDT`,
          evaluator: `${formatUnits(evaluatorFee, USDT_DECIMALS)} USDT`,
          platform: `${formatUnits(platformFee, USDT_DECIMALS)} USDT`,
          total: `${formatUnits(budget, USDT_DECIMALS)} USDT`,
        },
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to complete job",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
