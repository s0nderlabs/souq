// Create Job — Create a new job on the Souq escrow contract
// Pins description to IPFS, encodes createJob calldata, sends tx
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  encodeFunctionData,
  zeroAddress,
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";
import { getAddress, sendTx, getPublicClient } from "../protocol.js";
import { ESCROW_ADDRESS, HOOK_ADDRESS, explorerTxUrl } from "../config.js";
import { escrowAbi } from "../abi/escrow.js";
import { pinJson, cidToBytes32, toIpfsUri } from "../ipfs.js";

const CreateJobSchema = z.object({
  description: z
    .string()
    .describe("Job description text. Will be pinned to IPFS."),
  evaluator: z
    .string()
    .describe("Address of the evaluator (judge) for this job."),
  provider: z
    .string()
    .default("")
    .describe(
      "Address of the provider (worker). Empty string or zero address for open jobs."
    ),
  expiresInHours: z
    .number()
    .default(24)
    .describe("Hours until job expires. Default 24."),
  useHook: z
    .boolean()
    .default(false)
    .describe(
      "Whether to use the SigilGateHook for per-job compliance policies. Default false."
    ),
});

interface CreateJobResult {
  success: boolean;
  message: string;
  job?: {
    jobId: string;
    descriptionCid: string;
    descriptionUri: string;
    txHash: string;
    explorerUrl: string;
    client: string;
    evaluator: string;
    provider: string;
    expiresAt: string;
    hook: string;
  };
  error?: string;
}

export function registerCreateJob(server: McpServer): void {
  server.tool(
    "create_job",
    "Create a new job on the Souq escrow contract. Pins description to IPFS.",
    CreateJobSchema.shape,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result = await createJobHandler(params as z.infer<typeof CreateJobSchema>);
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

async function createJobHandler(
  params: z.infer<typeof CreateJobSchema>
): Promise<CreateJobResult> {
  try {
    const clientAddress = await getAddress();
    const publicClient = getPublicClient();

    // Pin description to IPFS
    const descriptionPayload = {
      type: "job_description",
      content: params.description,
      createdBy: clientAddress,
      createdAt: new Date().toISOString(),
    };
    const { cid: descriptionCid } = await pinJson(descriptionPayload);
    const descriptionHash = cidToBytes32(descriptionCid);

    // Compute expiration timestamp
    const currentBlock = await publicClient.getBlock();
    const currentTimestamp = currentBlock.timestamp;
    const expiresInSeconds = BigInt(params.expiresInHours * 3600);
    const expiredAt = currentTimestamp + expiresInSeconds;

    // Resolve addresses
    const providerAddress: Address =
      params.provider && params.provider.length > 0 && params.provider !== "0x"
        ? (params.provider as Address)
        : zeroAddress;
    const evaluatorAddress = params.evaluator as Address;
    const hookAddress: Address = params.useHook ? HOOK_ADDRESS : zeroAddress;

    // Encode createJob calldata
    const data = encodeFunctionData({
      abi: escrowAbi,
      functionName: "createJob",
      args: [
        providerAddress,
        evaluatorAddress,
        expiredAt,
        descriptionHash,
        hookAddress,
        "0x" as Hex, // optParams: empty bytes
      ],
    });

    // Send transaction
    const txResult = await sendTx(ESCROW_ADDRESS, data);

    // Wait for receipt and parse JobCreated event
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txResult.hash as `0x${string}`,
    });

    let jobId = "unknown";
    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: escrowAbi,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName === "JobCreated") {
          jobId = (decoded.args as { jobId: bigint }).jobId.toString();
          break;
        }
      } catch {
        // Not a matching event, skip
      }
    }

    return {
      success: true,
      message: `Job #${jobId} created successfully`,
      job: {
        jobId,
        descriptionCid,
        descriptionUri: toIpfsUri(descriptionCid),
        txHash: txResult.hash,
        explorerUrl: explorerTxUrl(txResult.hash),
        client: clientAddress,
        evaluator: params.evaluator,
        provider: providerAddress,
        expiresAt: new Date(Number(expiredAt) * 1000).toISOString(),
        hook: hookAddress,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to create job",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
