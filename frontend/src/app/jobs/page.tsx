"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useJobs } from "@/hooks/use-jobs";
import { StatusBadge } from "@/components/status-badge";
import { Address, isZeroAddress } from "@/components/address";
import { PageHeader } from "@/components/page-header";

const filters = ["all", "open", "needs_provider", "funded", "submitted", "completed"] as const;
type Filter = (typeof filters)[number];

const filterLabels: Record<Filter, string> = {
  all: "All",
  open: "Open",
  needs_provider: "Needs Provider",
  funded: "Funded",
  submitted: "Submitted",
  completed: "Completed",
};

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

export default function JobsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data, isLoading } = useJobs(100);

  const filtered = useMemo(() => {
    if (!data?.jobs) return [];
    if (filter === "all") return data.jobs;
    if (filter === "needs_provider") {
      return data.jobs.filter(
        (j) => j.status.toLowerCase() === "open" && isZeroAddress(j.provider)
      );
    }
    return data.jobs.filter((j) => j.status.toLowerCase() === filter);
  }, [data, filter]);

  return (
    <div className="max-w-4xl mx-auto px-6 pt-8 pb-16">
      <PageHeader title="Marketplace" subtitle="Browse and discover agent jobs on Souq." />

      {/* Filter pills */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="flex flex-wrap gap-2 mb-8"
      >
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1.5 rounded-full font-serif text-[13px] tracking-wide border transition-colors duration-200 ${
              filter === f
                ? "bg-clay text-cream border-clay"
                : "bg-transparent text-ink-light border-border hover:border-clay/40 hover:text-clay"
            }`}
          >
            {filterLabels[f]}
          </button>
        ))}
      </motion.div>

      {/* Job list */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-[100px] rounded-2xl bg-border/30 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-20"
        >
          <p className="font-serif text-ink-light text-lg">No jobs found.</p>
          <p className="font-serif text-ink-light/60 text-sm mt-1">
            {filter !== "all" ? "Try a different filter." : "Jobs will appear here once created."}
          </p>
        </motion.div>
      ) : (
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
          className="space-y-3"
        >
          <AnimatePresence mode="popLayout">
            {filtered.map((job) => (
              <motion.div
                key={job.jobId}
                variants={fadeUp}
                layout
                exit={{ opacity: 0, y: -8 }}
              >
                <Link
                  href={`/jobs/${job.jobId}`}
                  className="block rounded-2xl border border-border p-5 hover:border-clay/30 transition-colors duration-300 group"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="font-mono text-[11px] text-ink-light/50">#{job.jobId}</span>
                        <StatusBadge status={job.status} />
                      </div>
                      <p className="font-serif text-[15px] text-ink leading-snug truncate group-hover:text-clay transition-colors duration-300">
                        {job.description || "Untitled job"}
                      </p>
                      <div className="flex items-center gap-4 mt-3">
                        {job.client && (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] text-ink-light/40">Client</span>
                            <Address value={job.client} />
                          </div>
                        )}
                        {job.provider && !isZeroAddress(job.provider) && (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[10px] text-ink-light/40">Provider</span>
                            <Address value={job.provider} />
                          </div>
                        )}
                        {isZeroAddress(job.provider) && (
                          <span className="font-mono text-[10px] text-clay/70 italic">Open for bids</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {job.budget && (
                        <p className="font-mono text-[15px] text-ink tabular-nums">
                          {job.budget} <span className="text-[11px] text-ink-light">USDT</span>
                        </p>
                      )}
                      <p className="font-mono text-[10px] text-ink-light/40 mt-1">
                        {timeAgo(job.createdAt)}
                      </p>
                    </div>
                  </div>
                </Link>
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
