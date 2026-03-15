import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData } from "viem";
import { sendTx } from "../protocol.js";
import { REPUTATION_REGISTRY, explorerTxUrl } from "../config.js";
import { reputationAbi } from "../abi/reputation.js";
import { pinJson, cidToBytes32, toIpfsUri } from "../ipfs.js";

const Schema = z.object({
  agentId: z.number().describe("The ERC-8004 agent ID to give feedback to"),
  score: z.number().min(0).max(100).describe("Score from 0 to 100"),
  tag: z.string().describe("Category tag (e.g. 'research', 'evaluation', 'delivery')"),
  feedback: z.string().describe("Text feedback"),
  jobId: z.number().describe("Related job ID for context"),
});

interface GiveFeedbackResult {
  success: boolean;
  message: string;
  transaction?: {
    hash: string;
    explorerUrl: string;
  };
  feedback?: {
    agentId: number;
    score: number;
    tag: string;
    jobId: number;
    ipfsCid: string;
    ipfsUri: string;
  };
  error?: string;
}

export function registerGiveFeedback(server: McpServer): void {
  server.tool(
    "give_feedback",
    "Give voluntary reputation feedback to another agent (Uber-style rating)",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<GiveFeedbackResult> {
  try {
    // Build feedback payload and pin to IPFS
    const feedbackPayload = {
      agentId: params.agentId,
      score: params.score,
      tag: params.tag,
      feedback: params.feedback,
      jobId: params.jobId,
      createdAt: new Date().toISOString(),
    };

    const { cid } = await pinJson(feedbackPayload);
    const ipfsUri = toIpfsUri(cid);
    const feedbackHash = cidToBytes32(cid);

    // Encode giveFeedback call
    // giveFeedback(agentId, value, valueDecimals, tag1, tag2, endpoint, feedbackURI, feedbackHash)
    const data = encodeFunctionData({
      abi: reputationAbi,
      functionName: "giveFeedback",
      args: [
        BigInt(params.agentId),
        BigInt(params.score),  // int128
        0,                     // valueDecimals (uint8)
        params.tag,            // tag1
        "",                    // tag2
        "",                    // endpoint
        ipfsUri,               // feedbackURI
        feedbackHash,          // feedbackHash (bytes32)
      ],
    });

    const { hash } = await sendTx(REPUTATION_REGISTRY, data);

    return {
      success: true,
      message: `Feedback given to agent #${params.agentId}: ${params.score}/100 (${params.tag})`,
      transaction: {
        hash,
        explorerUrl: explorerTxUrl(hash),
      },
      feedback: {
        agentId: params.agentId,
        score: params.score,
        tag: params.tag,
        jobId: params.jobId,
        ipfsCid: cid,
        ipfsUri,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to give feedback",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
