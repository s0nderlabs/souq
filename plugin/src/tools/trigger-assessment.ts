import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getWdkAccount, getAddress } from "../protocol.js";
import { getSouqApiUrl } from "../config.js";

const Schema = z.object({
  agentId: z.number().describe("Your ERC-8004 agent token ID"),
  policyId: z.string().describe("The policy ID (bytes32 hex) to assess against"),
});

interface TriggerAssessmentResult {
  success: boolean;
  message: string;
  assessment?: {
    agentId: string;
    policyId: string;
    score?: number;
    compliant?: boolean;
    evidenceURI?: string;
    requestHash?: string;
  };
  error?: string;
}

export function registerTriggerAssessment(server: McpServer): void {
  server.tool(
    "trigger_assessment",
    "Trigger a Sigil compliance assessment for your agent against a policy. Requires a registered ERC-8004 identity.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<TriggerAssessmentResult> {
  try {
    const account = await getWdkAccount();
    const agentId = params.agentId.toString();
    const policyId = params.policyId;

    // Build the message: sigil:assess:{agentId}:{policyId}:{timestamp}
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `sigil:assess:${agentId}:${policyId}:${timestamp}`;

    // Sign with WDK (EIP-191 personal_sign via EOA)
    const signature = await account.sign(message);

    // POST to relay (proxies to Sigil server)
    const apiUrl = getSouqApiUrl();
    const response = await fetch(`${apiUrl}/sigil/assess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId,
        policyId,
        message,
        signature,
      }),
    });

    if (!response.ok) {
      const error = (await response.json()) as { error?: string; message?: string };
      return {
        success: false,
        message: `Assessment failed: ${error.error || error.message || response.statusText}`,
        error: JSON.stringify(error),
      };
    }

    const result = (await response.json()) as {
      agentId?: string;
      policyId?: string;
      requestHash?: string;
      score?: number;
      compliant?: boolean;
      evidenceURI?: string;
      message?: string;
    };

    return {
      success: true,
      message: result.compliant != null
        ? `Assessment complete: ${result.compliant ? "COMPLIANT" : "NOT COMPLIANT"} (score: ${result.score})`
        : result.message || "Assessment submitted. Query later for results.",
      assessment: {
        agentId,
        policyId,
        score: result.score,
        compliant: result.compliant,
        evidenceURI: result.evidenceURI,
        requestHash: result.requestHash,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to trigger assessment",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
