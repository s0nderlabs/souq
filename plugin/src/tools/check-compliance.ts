import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Address } from "viem";
import { getPublicClient } from "../protocol.js";
import { SIGIL_ADDRESS } from "../config.js";
import { sigilAbi } from "../abi/sigil.js";

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
  };
  error?: string;
}

export function registerCheckCompliance(server: McpServer): void {
  server.tool(
    "check_compliance",
    "Check if a wallet is Sigil-compliant for a given policy.",
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

    const compliant = await publicClient.readContract({
      address: SIGIL_ADDRESS,
      abi: sigilAbi,
      functionName: "isCompliant",
      args: [params.wallet as Address, params.policyId as `0x${string}`],
    });

    return {
      success: true,
      message: compliant
        ? `Wallet ${params.wallet} is compliant for policy ${params.policyId}`
        : `Wallet ${params.wallet} is NOT compliant for policy ${params.policyId}`,
      compliance: {
        wallet: params.wallet,
        policyId: params.policyId,
        compliant,
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
