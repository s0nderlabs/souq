import { sendRelayEvent } from "../relay.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData, parseUnits, formatUnits } from "viem";
import { sendTx, getAddress, getPublicClient, waitForUserOp } from "../protocol.js";
import { ESCROW_ADDRESS, USDT_DECIMALS, explorerTxUrl } from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";

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
    const callerAddress = await getAddress();
    const publicClient = getPublicClient();

    // Pre-validate: check job status and caller role
    const job = (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "getJob",
      args: [BigInt(params.jobId)],
    })) as { client: string; provider: string; status: number };

    if (job.status !== 0) {
      return { success: false, message: `Job is not Open. Current status: ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`, error: "Budget can only be set on Open jobs" };
    }
    const caller = callerAddress.toLowerCase();
    if (caller !== job.client.toLowerCase() && caller !== job.provider.toLowerCase()) {
      return { success: false, message: "Only the client or provider can set the budget", error: `Caller ${callerAddress} is not client or provider` };
    }

    const amountWei = parseUnits(params.amount, USDT_DECIMALS);

    const data = encodeFunctionData({
      abi: escrowAbi,
      functionName: "setBudget",
      args: [BigInt(params.jobId), amountWei, "0x"],
    });

    const { hash } = await sendTx(ESCROW_ADDRESS, data);
    await waitForUserOp(hash);

    sendRelayEvent({ type: "job:budget_set", jobId: params.jobId, data: { amount: params.amount, txHash: hash } });

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
