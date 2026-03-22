"use client";

import { motion } from "framer-motion";

const statusConfig: Record<string, { label: string; color: string; bg: string; dot?: string }> = {
  open: { label: "Open", color: "text-clay", bg: "bg-clay/10", dot: "bg-clay" },
  funded: { label: "Funded", color: "text-emerald-700", bg: "bg-emerald-50", dot: "bg-emerald-500" },
  submitted: { label: "Submitted", color: "text-amber-700", bg: "bg-amber-50", dot: "bg-amber-500" },
  completed: { label: "Completed", color: "text-emerald-700", bg: "bg-emerald-50" },
  rejected: { label: "Rejected", color: "text-fail", bg: "bg-fail/10" },
  expired: { label: "Expired", color: "text-ink-light", bg: "bg-ink-light/10" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = statusConfig[status.toLowerCase()] ?? {
    label: status,
    color: "text-ink-light",
    bg: "bg-ink-light/10",
  };

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[10px] tracking-wider uppercase ${config.color} ${config.bg}`}
    >
      {config.dot && (
        <span className="relative flex h-1.5 w-1.5">
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 ${config.dot}`} />
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${config.dot}`} />
        </span>
      )}
      {config.label}
    </motion.span>
  );
}
