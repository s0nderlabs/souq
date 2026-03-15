import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData, parseUnits, formatUnits } from "viem";
import { sendTx } from "../protocol.js";
import { ESCROW_ADDRESS, USDT_DECIMALS, explorerTxUrl } from "../config.js";
import { escrowAbi } from "../abi/escrow.js";

const Schema = z.object({
  jobId: z.number().describe("The job ID to set the budget for"),
  amount: z.string().describe("Budget amount in human-readable USDT (e.g. '100.50')"),
});

interface SetBudgetResult {
  success: boolean;
  message: string;
  transaction?: {
    hash: string;
    explorerUrl: string;
  };
  budget?: {
    jobId: number;
    amount: string;
    amountWei: string;
  };
  error?: string;
}

export function registerSetBudget(server: McpServer): void {
  server.tool(
    "set_budget",
    "Set or update the budget for an open job. Client or provider can call.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<SetBudgetResult> {
  try {
    const amountWei = parseUnits(params.amount, USDT_DECIMALS);

    const data = encodeFunctionData({
      abi: escrowAbi,
      functionName: "setBudget",
      args: [BigInt(params.jobId), amountWei, "0x"],
    });

    const { hash } = await sendTx(ESCROW_ADDRESS, data);

    return {
      success: true,
      message: `Budget set to ${params.amount} USDT for job #${params.jobId}`,
      transaction: {
        hash,
        explorerUrl: explorerTxUrl(hash),
      },
      budget: {
        jobId: params.jobId,
        amount: `${formatUnits(amountWei, USDT_DECIMALS)} USDT`,
        amountWei: amountWei.toString(),
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to set budget",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
