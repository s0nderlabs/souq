"use client";

import { useQuery } from "@tanstack/react-query";
import { relay } from "@/lib/relay";

export function useJobs(limit = 50) {
  return useQuery({
    queryKey: ["jobs", limit],
    queryFn: () => relay.jobs(limit),
    refetchInterval: 60_000, // WebSocket handles real-time; this is fallback
  });
}
