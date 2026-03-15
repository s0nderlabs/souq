import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData, getAddress as viemGetAddress, type Address } from "viem";
import { sendTx } from "../protocol.js";
import { ESCROW_ADDRESS, explorerTxUrl } from "../config.js";
import { escrowAbi } from "../abi/escrow.js";

const Schema = z.object({
  jobId: z.number().describe("The job ID to assign a provider to"),
  provider: z.string().describe("The provider wallet address"),
});

interface SetProviderResult {
  success: boolean;
  message: string;
  transaction?: {
    hash: string;
    explorerUrl: string;
  };
  job?: {
    jobId: number;
    provider: string;
  };
  error?: string;
}

export function registerSetProvider(server: McpServer): void {
  server.tool(
    "set_provider",
    "Assign a provider to an open job (Type 2 bid-first flow)",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<SetProviderResult> {
  try {
    const providerAddress = viemGetAddress(params.provider) as Address;

    const data = encodeFunctionData({
      abi: escrowAbi,
      functionName: "setProvider",
      args: [BigInt(params.jobId), providerAddress, "0x"],
    });

    const { hash } = await sendTx(ESCROW_ADDRESS, data);

    return {
      success: true,
      message: `Provider assigned to job #${params.jobId}`,
      transaction: {
        hash,
        explorerUrl: explorerTxUrl(hash),
      },
      job: {
        jobId: params.jobId,
        provider: providerAddress,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to set provider",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
