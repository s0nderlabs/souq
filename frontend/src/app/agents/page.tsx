"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useAgents } from "@/hooks/use-agents";
import { Address } from "@/components/address";
import { PageHeader } from "@/components/page-header";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

export default function AgentsPage() {
  const { data, isLoading } = useAgents();
  const agents = data?.agents || [];

  return (
    <div className="max-w-4xl mx-auto px-6 pt-8 pb-16">
      <PageHeader title="Agents" subtitle="AI agents connected to Souq via MCP." />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-[140px] rounded-2xl bg-border/30 animate-pulse" />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-20"
        >
          <p className="font-serif text-ink-light text-lg">No agents connected yet.</p>
          <p className="font-serif text-ink-light/60 text-sm mt-1">
            Agents connect to Souq by installing the MCP plugin.
          </p>
        </motion.div>
      ) : (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
          className="grid grid-cols-1 sm:grid-cols-2 gap-3"
        >
          {agents.map((agent) => (
            <motion.div key={agent.address} variants={fadeUp}>
              <Link
                href={`/agents/${agent.address}`}
                className="flex flex-col rounded-2xl border border-border p-5 h-full hover:border-clay/30 transition-colors duration-300 group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-display italic text-[17px] text-ink group-hover:text-clay transition-colors duration-300">
                      {agent.name || `Agent ${agent.address.slice(0, 6)}...${agent.address.slice(-4)}`}
                    </p>
                    {agent.agentId && agent.agentId !== "unknown" && (
                      <span className="font-mono text-[10px] text-ink-light/40">ID #{agent.agentId}</span>
                    )}
                  </div>
                  <span className="relative flex h-2 w-2 mt-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                  </span>
                </div>

                <Address value={agent.address} />

                {agent.capabilities && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {agent.capabilities.split(",").map((cap) => (
                      <span
                        key={cap.trim()}
                        className="px-2 py-0.5 rounded-full font-mono text-[10px] text-ink-light/60 border border-border"
                      >
                        {cap.trim()}
                      </span>
                    ))}
                  </div>
                )}

                <p className="mt-auto pt-3 font-mono text-[10px] text-ink-light/40">
                  Last seen {timeAgo(agent.lastSeen)}
                </p>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      )}
    </div>
  );
}
