import { sendRelayEvent } from "../relay.js";
// Create Job — Create a new job on the Souq escrow contract
// Pins description to IPFS, encodes createJob calldata, sends tx
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  encodeFunctionData,
  encodeAbiParameters,
  zeroAddress,
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";
import { getAddress, sendTx, getPublicClient, waitForUserOp } from "../protocol.js";
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
  clientAgentId: z
    .number()
    .default(0)
    .describe("ERC-8004 agent ID of the client. Required when useHook=true."),
  providerAgentId: z
    .number()
    .default(0)
    .describe("ERC-8004 agent ID of the provider. Required when useHook=true and provider is set."),
  evaluatorAgentId: z
    .number()
    .default(0)
    .describe("ERC-8004 agent ID of the evaluator. Required when useHook=true."),
  providerPolicies: z
    .array(z.string())
    .default([])
    .describe("Sigil policy IDs (bytes32 hex) for the provider. Required when useHook=true and provider is set."),
  evaluatorPolicies: z
    .array(z.string())
    .default([])
    .describe("Sigil policy IDs (bytes32 hex) for the evaluator. Required when useHook=true."),
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

    // Encode optParams for the hook (if enabled)
    let optParams: Hex = "0x";
    if (params.useHook) {
      // SigilGateHook.afterCreateJob expects:
      // abi.encode(clientAgentId, providerAgentId, evaluatorAgentId, providerPolicies[], evaluatorPolicies[])
      optParams = encodeAbiParameters(
        [
          { type: "uint256" },
          { type: "uint256" },
          { type: "uint256" },
          { type: "bytes32[]" },
          { type: "bytes32[]" },
        ],
        [
          BigInt(params.clientAgentId),
          BigInt(params.providerAgentId),
          BigInt(params.evaluatorAgentId),
          (params.providerPolicies as string[]).map((p) => p as Hex),
          (params.evaluatorPolicies as string[]).map((p) => p as Hex),
        ]
      );
    }

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
        optParams,
      ],
    });

    // Send transaction (WDK builds + signs + submits UserOp)
    console.error(`[souq] create_job: sending tx...`);
    const txResult = await sendTx(ESCROW_ADDRESS, data);
    console.error(`[souq] create_job: tx sent, waiting for UserOp receipt...`);

    // Wait for UserOp confirmation and parse JobCreated event
    const { receipt } = await waitForUserOp(txResult.hash);
    console.error(`[souq] create_job: receipt received`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const txReceipt = receipt as any;

    let jobId = "unknown";
    for (const log of txReceipt.logs) {
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

    sendRelayEvent({ type: "job:created", jobId: Number(jobId), data: { client: clientAddress, provider: params.provider, evaluator: params.evaluator, description: params.description, descriptionCid, txHash: txResult.hash } });

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
