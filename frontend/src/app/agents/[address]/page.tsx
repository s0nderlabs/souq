"use client";

import { use, useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useAgents } from "@/hooks/use-agents";
import { useJobs } from "@/hooks/use-jobs";
import { Address } from "@/components/address";
import { StatusBadge } from "@/components/status-badge";

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
  hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.06 } },
};

export default function AgentProfilePage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const { data: agentsData } = useAgents();
  const { data: jobsData } = useJobs(100);

  const agent = agentsData?.agents.find(
    (a) => a.address.toLowerCase() === address.toLowerCase()
  );

  const relatedJobs = useMemo(() => {
    if (!jobsData?.jobs) return [];
    const addr = address.toLowerCase();
    return jobsData.jobs.filter(
      (j) =>
        j.client?.toLowerCase() === addr ||
        j.provider?.toLowerCase() === addr ||
        j.evaluator?.toLowerCase() === addr
    );
  }, [jobsData, address]);

  return (
    <div className="max-w-3xl mx-auto px-6 pt-8 pb-16">
      <Link
        href="/agents"
        className="inline-flex items-center gap-1.5 font-serif text-[13px] text-ink-light hover:text-clay transition-colors duration-200 mb-6"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 4l-4 4 4 4" />
        </svg>
        Back to agents
      </Link>

      <motion.div initial="hidden" animate="visible" variants={stagger}>
        {/* Agent card */}
        <motion.div variants={fadeUp} className="rounded-2xl border border-border p-6 mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="font-display italic text-2xl text-ink">
                {agent?.name || `Agent ${address.slice(0, 6)}...${address.slice(-4)}`}
              </h1>
              {agent?.agentId && agent.agentId !== "unknown" && (
                <span className="font-mono text-[11px] text-ink-light/50">Agent ID #{agent.agentId}</span>
              )}
            </div>
            {agent && (
              <span className="relative flex h-2.5 w-2.5 mt-1">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </span>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1">Address</p>
              <Address value={address} />
            </div>

            {agent?.capabilities && (
              <div>
                <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1.5">Capabilities</p>
                <div className="flex flex-wrap gap-1.5">
                  {agent.capabilities.split(",").map((cap) => (
                    <span
                      key={cap.trim()}
                      className="px-2.5 py-1 rounded-full font-mono text-[10px] text-clay bg-clay/[0.06] border border-clay/10"
                    >
                      {cap.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {agent?.lastSeen && (
              <div>
                <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1">Last Seen</p>
                <p className="font-mono text-[12px] text-ink-light">{timeAgo(agent.lastSeen)}</p>
              </div>
            )}

            {agent?.encryptionPublicKey && (
              <div>
                <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1">Encryption Key</p>
                <p className="font-mono text-[11px] text-ink-light/60 break-all">
                  {agent.encryptionPublicKey.slice(0, 20)}...{agent.encryptionPublicKey.slice(-10)}
                </p>
              </div>
            )}
          </div>
        </motion.div>

        {/* Job history */}
        <motion.div variants={fadeUp}>
          <h2 className="font-display italic text-lg text-ink mb-3">Job History</h2>
          {relatedJobs.length === 0 ? (
            <div className="rounded-2xl border border-border p-5 text-center">
              <p className="font-serif text-ink-light text-sm">No jobs found for this agent.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {relatedJobs.map((job) => {
                const addr = address.toLowerCase();
                const role =
                  job.client?.toLowerCase() === addr ? "Client" :
                  job.provider?.toLowerCase() === addr ? "Provider" :
                  "Evaluator";

                return (
                  <Link
                    key={job.jobId}
                    href={`/jobs/${job.jobId}`}
                    className="block rounded-xl border border-border p-4 hover:border-clay/30 transition-colors duration-300"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[11px] text-ink-light/50">#{job.jobId}</span>
                        <StatusBadge status={job.status} />
                        <span className="px-2 py-0.5 rounded-full font-mono text-[10px] text-ink-light/60 border border-border">
                          {role}
                        </span>
                      </div>
                      <span className="font-mono text-[12px] text-ink-light/40">{timeAgo(job.createdAt)}</span>
                    </div>
                    <p className="font-serif text-[13px] text-ink mt-2 truncate">
                      {job.description || "Untitled job"}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
