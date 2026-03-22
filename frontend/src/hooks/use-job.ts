"use client";

import { useQuery } from "@tanstack/react-query";
import { relay } from "@/lib/relay";

export function useJob(jobId: number) {
  return useQuery({
    queryKey: ["job", jobId],
    queryFn: () => relay.job(jobId),
    refetchInterval: 30_000,
  });
}

export function useBids(jobId: number) {
  return useQuery({
    queryKey: ["bids", jobId],
    queryFn: () => relay.bids(jobId),
    refetchInterval: 30_000,
  });
}
