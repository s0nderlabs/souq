import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Address } from "viem";
import { getPublicClient } from "../protocol.js";
import { SIGIL_ADDRESS, getSouqApiUrl } from "../config.js";
import { sigilAbi } from "../abi/sigil.js";
import { originalFetch } from "../x402-fetch-patch.js";

const Schema = z.object({
  wallet: z.string().describe("Wallet address to check compliance for"),
  policyId: z.string().describe("Policy ID (bytes32 hex) to check against"),
});

interface CheckComplianceResult {
  success: boolean;
  message: string;
  compliance?: {
    wallet: string;
    policyId: string;
    compliant: boolean;
    score?: number;
    lastUpdate?: string;
    expiresAt?: string;
    policy?: {
      name: string;
      description: string;
    };
    latestAssessment?: {
      evidenceUri?: string;
      tag?: string;
      createdAt?: string;
    };
  };
  error?: string;
}

export function registerCheckCompliance(server: McpServer): void {
  server.tool(
    "check_compliance",
    "Check if a wallet is Sigil-compliant for a given policy. Returns compliance status, score, and policy details.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<CheckComplianceResult> {
  try {
    const publicClient = getPublicClient();
    const wallet = params.wallet as Address;
    const policyId = params.policyId as `0x${string}`;

    // Read on-chain compliance status + policy details in parallel
    const [status, policy] = await Promise.all([
      publicClient.readContract({
        address: SIGIL_ADDRESS,
        abi: sigilAbi,
        functionName: "getComplianceStatus",
        args: [wallet, policyId],
      }) as Promise<{ compliant: boolean; score: number; expiresAt: bigint; lastUpdate: bigint }>,
      publicClient.readContract({
        address: SIGIL_ADDRESS,
        abi: sigilAbi,
        functionName: "getPolicy",
        args: [policyId],
      }) as Promise<{ name: string; description: string; isPublic: boolean; isActive: boolean; registeredBy: string }>,
    ]);

    const hasBeenAssessed = status.lastUpdate > 0n;

    // Fetch latest assessment from Sigil API (via relay) for evidence details
    let latestAssessment: { evidenceUri?: string; tag?: string; createdAt?: string } | undefined;
    try {
      const apiUrl = getSouqApiUrl();
      const res = await originalFetch(`${apiUrl}/sigil/assessments?wallet=${params.wallet}`);
      if (res.ok) {
        const assessments = await res.json() as Array<{
          policy_id: string;
          evidence_uri?: string;
          tag?: string;
          created_at?: string;
          score?: number;
        }>;
        // Find the latest assessment for this specific policy
        const match = assessments.find(a =>
          a.policy_id === params.policyId || a.policy_id === policyId
        );
        if (match) {
          latestAssessment = {
            evidenceUri: match.evidence_uri,
            tag: match.tag,
            createdAt: match.created_at,
          };
        }
      }
    } catch {
      // Non-fatal — on-chain data is sufficient
    }

    let message: string;
    if (!hasBeenAssessed) {
      message = `Wallet ${params.wallet} has NOT been assessed for policy "${policy.name}". Run trigger_assessment first.`;
    } else if (status.compliant) {
      message = `Wallet ${params.wallet} is COMPLIANT (score: ${status.score}/100) for policy "${policy.name}"`;
    } else {
      message = `Wallet ${params.wallet} is NOT compliant (score: ${status.score}/100) for policy "${policy.name}" — ${policy.description}`;
    }

    return {
      success: true,
      message,
      compliance: {
        wallet: params.wallet,
        policyId: params.policyId,
        compliant: status.compliant,
        score: status.score,
        lastUpdate: hasBeenAssessed ? new Date(Number(status.lastUpdate) * 1000).toISOString() : undefined,
        expiresAt: status.expiresAt > 0n ? new Date(Number(status.expiresAt) * 1000).toISOString() : undefined,
        policy: {
          name: policy.name,
          description: policy.description,
        },
        latestAssessment,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to check compliance",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
