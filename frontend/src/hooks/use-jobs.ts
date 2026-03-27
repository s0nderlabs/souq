"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import { relay } from "@/lib/relay";
import { ESCROW_ADDRESS, escrowAbi, TERMINAL_STATUSES, parseOnChainJobStatus } from "@/lib/contracts";

export function useJobs(limit = 50) {
  return useQuery({
    queryKey: ["jobs", limit],
    queryFn: () => relay.jobs(limit),
    refetchInterval: 60_000,
  });
}

/**
 * Wraps useJobs with an on-chain multicall that corrects stale relay statuses.
 * If a terminal tx (completeJob, rejectJob, expiry) fires while the agent's WS
 * is disconnected, the relay never records it. This hook catches those cases.
 */
export function useJobsWithOnChainStatus(limit = 100) {
  const { data, isLoading, ...rest } = useJobs(limit);

  const nonTerminalJobs = useMemo(() => {
    if (!data?.jobs) return [];
    return data.jobs.filter((j) => !TERMINAL_STATUSES.has(j.status.toLowerCase()));
  }, [data?.jobs]);

  // Stable key so useReadContracts doesn't refetch when relay polls but IDs are unchanged
  const nonTerminalKey = useMemo(
    () => nonTerminalJobs.map((j) => j.jobId).join(","),
    [nonTerminalJobs],
  );

  const contracts = useMemo(
    () =>
      nonTerminalJobs.map((j) => ({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "getJob" as const,
        args: [BigInt(j.jobId)] as const,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on stable ID string
    [nonTerminalKey],
  );

  const { data: onChainResults } = useReadContracts({
    contracts,
    query: {
      enabled: nonTerminalJobs.length > 0,
      refetchInterval: 120_000,
      staleTime: 60_000,
    },
  });

  const overrideMap = useMemo(() => {
    if (!onChainResults) return null;
    const map = new Map<number, string>();
    nonTerminalJobs.forEach((job, i) => {
      const result = onChainResults[i];
      if (result?.status !== "success" || !result.result) return;
      const status = parseOnChainJobStatus(result.result);
      if (TERMINAL_STATUSES.has(status)) {
        map.set(job.jobId, status);
      }
    });
    return map.size > 0 ? map : null;
  }, [onChainResults, nonTerminalJobs]);

  const mergedJobs = useMemo(() => {
    const jobs = data?.jobs;
    if (!jobs) return [];
    if (!overrideMap) return jobs;
    return jobs.map((job) => {
      const override = overrideMap.get(job.jobId);
      return override ? { ...job, status: override } : job;
    });
  }, [data?.jobs, overrideMap]);

  const result = useMemo(
    () => (data ? { jobs: mergedJobs } : undefined),
    [data, mergedJobs],
  );

  return { data: result, isLoading, ...rest };
}
