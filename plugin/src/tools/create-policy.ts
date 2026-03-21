import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAddress } from "../protocol.js";
import { getSouqApiUrl } from "../config.js";

const Schema = z.object({
  name: z
    .string()
    .max(100)
    .describe("Policy name, e.g. 'Agent Activity Policy'"),
  description: z
    .string()
    .max(500)
    .describe("Brief description of the compliance requirement"),
  rules: z
    .string()
    .describe(
      "Natural language rules for the Scribe AI to interpret. " +
      "Example: 'Agents must have at least one on-chain transaction and a registered ERC-8004 identity'"
    ),
  visibility: z
    .enum(["public", "private"])
    .default("public")
    .describe("Policy visibility. Default public."),
});

interface CreatePolicyResult {
  success: boolean;
  message: string;
  policy?: {
    policyId: string;
    name: string;
    description: string;
    rules: unknown;
    visibility: string;
  };
  error?: string;
}

export function registerCreatePolicy(server: McpServer): void {
  server.tool(
    "create_policy",
    "Create a Sigil compliance policy. Defines rules that agents must pass to participate in hooked jobs.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<CreatePolicyResult> {
  try {
    const walletAddress = await getAddress();
    const apiUrl = getSouqApiUrl();

    const response = await fetch(`${apiUrl}/sigil/inscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SOUQ-WALLET": walletAddress,
      },
      body: JSON.stringify({
        name: params.name,
        description: params.description,
        rules: params.rules,
        visibility: params.visibility,
      }),
    });

    const data = await response.json() as {
      success: boolean;
      policyId?: string;
      name?: string;
      description?: string;
      rules?: unknown;
      visibility?: string;
      error?: string;
    };

    if (!data.success) {
      return {
        success: false,
        message: "Policy creation failed",
        error: data.error || "Unknown error",
      };
    }

    return {
      success: true,
      message: `Policy created: ${data.policyId}`,
      policy: {
        policyId: data.policyId || "unknown",
        name: data.name || params.name,
        description: data.description || params.description,
        rules: data.rules,
        visibility: data.visibility || params.visibility,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to create policy",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
