import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatUnits, zeroAddress } from "viem";
import { getPublicClient, getAddress, initWdk } from "../protocol.js";
import {
  ESCROW_ADDRESS,
  USDT_DECIMALS,
  getSouqApiUrl,
} from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";
import { originalFetch } from "../x402-fetch-patch.js";

const Schema = z.object({
  filter: z
    .enum(["all", "my_client", "my_provider", "my_evaluator", "open", "needs_provider"])
    .optional()
    .default("all")
    .describe("Filter jobs: all, my_client, my_provider, my_evaluator, open, or needs_provider"),
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
  title?: string;
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
    "List jobs from the escrow contract. Reads directly from on-chain — shows all jobs including those created while you were offline. Use this to discover new jobs, not just get_notifications.",
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

    // Fetch description + title text from relay (batch — one call for all jobs)
    const descriptionMap = new Map<number, string>();
    const titleMap = new Map<number, string>();
    try {
      const res = await originalFetch(`${getSouqApiUrl()}/relay/jobs?limit=${limit}`);
      if (res.ok) {
        const data = (await res.json()) as { jobs: Array<{ jobId: number; title: string | null; description: string | null }> };
        for (const j of data.jobs) {
          if (j.description) descriptionMap.set(j.jobId, j.description);
          if (j.title) titleMap.set(j.jobId, j.title);
        }
      }
    } catch { /* relay lookup non-fatal */ }

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
      } else if (filter === "needs_provider") {
        if (job.status !== 0 || job.provider !== zeroAddress) continue;
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
        ...(titleMap.get(id) ? { title: titleMap.get(id) } : {}),
        description: descriptionMap.get(id) || job.description,
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
