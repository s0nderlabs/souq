import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatUnits, zeroAddress } from "viem";
import { getPublicClient, getAddress, initWdk } from "../protocol.js";
import {
  ESCROW_ADDRESS,
  USDT_DECIMALS,
} from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";

const Schema = z.object({
  filter: z
    .enum(["all", "my_client", "my_provider", "my_evaluator", "open"])
    .optional()
    .default("all")
    .describe("Filter jobs: all, my_client, my_provider, my_evaluator, or open"),
  limit: z
    .number()
    .optional()
    .default(20)
    .describe("Maximum number of jobs to return (default 20)"),
});

interface JobInfo {
  jobId: number;
  client: string;
  provider: string;
  evaluator: string;
  budget: string;
  status: string;
  expiredAt: string;
  description: string;
  deliverable: string;
  hook: string;
}

interface ListJobsResult {
  success: boolean;
  message: string;
  totalJobs?: number;
  returned?: number;
  filter?: string;
  jobs?: JobInfo[];
  error?: string;
}

export function registerListJobs(server: McpServer): void {
  server.tool(
    "list_jobs",
    "List jobs from the escrow contract. Filter by role or status.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<ListJobsResult> {
  try {
    const publicClient = getPublicClient();
    const filter = params.filter ?? "all";
    const limit = params.limit ?? 20;

    // Get my address for role-based filters (requires WDK init)
    let myAddress: string | null = null;
    if (filter !== "all" && filter !== "open") {
      await initWdk();
      myAddress = (await getAddress()).toLowerCase();
    }

    // Read total job count
    const jobCount = await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "jobCount",
    }) as bigint;

    const total = Number(jobCount);

    if (total === 0) {
      return {
        success: true,
        message: "No jobs found",
        totalJobs: 0,
        returned: 0,
        filter,
        jobs: [],
      };
    }

    // Iterate from newest to oldest, collect matching jobs
    const jobs: JobInfo[] = [];

    for (let id = total; id >= 1 && jobs.length < limit; id--) {
      const job = await publicClient.readContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "getJob",
        args: [BigInt(id)],
      }) as {
        client: string;
        provider: string;
        evaluator: string;
        budget: bigint;
        expiredAt: bigint;
        description: string;
        deliverable: string;
        hook: string;
        status: number;
      };

      const statusName = JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? `Unknown(${job.status})`;

      // Apply filter
      if (filter === "open") {
        if (job.status !== 0) continue;
      } else if (filter === "my_client") {
        if (job.client.toLowerCase() !== myAddress) continue;
      } else if (filter === "my_provider") {
        if (job.provider.toLowerCase() !== myAddress) continue;
      } else if (filter === "my_evaluator") {
        if (job.evaluator.toLowerCase() !== myAddress) continue;
      }

      const expiredAtDate = new Date(Number(job.expiredAt) * 1000);

      jobs.push({
        jobId: id,
        client: job.client,
        provider: job.provider === zeroAddress ? "(none)" : job.provider,
        evaluator: job.evaluator === zeroAddress ? "(none)" : job.evaluator,
        budget: job.budget === 0n ? "(not set)" : `${formatUnits(job.budget, USDT_DECIMALS)} USDT`,
        status: statusName,
        expiredAt: expiredAtDate.toISOString(),
        description: job.description,
        deliverable: job.deliverable,
        hook: job.hook === zeroAddress ? "(none)" : job.hook,
      });
    }

    return {
      success: true,
      message: `Found ${jobs.length} job(s)${filter !== "all" ? ` (filter: ${filter})` : ""}`,
      totalJobs: total,
      returned: jobs.length,
      filter,
      jobs,
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to list jobs",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
