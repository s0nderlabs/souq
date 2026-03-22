"use client";

import { useQuery } from "@tanstack/react-query";
import { relay } from "@/lib/relay";

export function useAgents(limit = 50) {
  return useQuery({
    queryKey: ["agents", limit],
    queryFn: () => relay.agents(limit),
    refetchInterval: 60_000,
  });
}
