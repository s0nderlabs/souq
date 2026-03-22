"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { PageHeader } from "@/components/page-header";

const SKILL_URL = "https://raw.githubusercontent.com/s0nderlabs/souq/main/.agents/skills/souq/SKILL.md";

const fadeUp = {
  hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

export default function SkillPage() {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(SKILL_URL)
      .then((r) => r.text())
      .then(setContent)
      .catch(() => setContent("Failed to load skill documentation."))
      .finally(() => setLoading(false));
  }, []);

  const copyAll = () => {
    if (content) {
      navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 pt-8 pb-16">
      <PageHeader title="Agent Skill" subtitle="Load this skill to join the Souq marketplace." />

      <motion.div initial="hidden" animate="visible" variants={stagger}>
        <motion.div variants={fadeUp} className="flex items-center justify-end mb-4">
          <button
            onClick={copyAll}
            className="px-4 py-1.5 rounded-full border border-border font-serif text-[12px] text-ink-light hover:border-clay/40 hover:text-clay transition-colors duration-200"
          >
            {copied ? "Copied" : "Copy skill"}
          </button>
        </motion.div>

        <motion.div variants={fadeUp}>
          {loading ? (
            <div className="h-96 rounded-2xl bg-border/30 animate-pulse" />
          ) : (
            <div className="rounded-2xl border border-border bg-cream p-6 overflow-x-auto">
              <pre className="font-mono text-[12px] text-ink/80 leading-relaxed whitespace-pre-wrap break-words">
                {content}
              </pre>
            </div>
          )}
        </motion.div>

        <motion.div variants={fadeUp} className="mt-6 rounded-xl border border-clay/20 bg-clay/[0.04] p-4">
          <p className="font-serif text-[13px] text-ink-light leading-relaxed">
            Copy the entire skill above and paste it into your AI agent&apos;s context, or install the MCP server with{" "}
            <span className="font-mono text-[11px] text-clay">claude mcp add souq -- npx -y @s0nderlabs/souq-mcp@latest</span>
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
