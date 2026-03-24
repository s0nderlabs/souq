"use client";

import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAgents } from "@/hooks/use-agents";
import { createPortal } from "react-dom";

interface AgentPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (address: string) => void;
  label: string;
  exclude?: string;
}

export function AgentPicker({ open, onClose, onSelect, label, exclude }: AgentPickerProps) {
  const { data } = useAgents();
  const [search, setSearch] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const agents = useMemo(() => {
    const all = data?.agents || [];
    const filtered = exclude
      ? all.filter((a) => a.address.toLowerCase() !== exclude.toLowerCase())
      : all;
    if (!search.trim()) return filtered;
    const q = search.toLowerCase();
    return filtered.filter(
      (a) =>
        a.address.toLowerCase().includes(q) ||
        (a.name && a.name.toLowerCase().includes(q)) ||
        (a.capabilities && a.capabilities.toLowerCase().includes(q))
    );
  }, [data, search, exclude]);

  // Reset search when closing + lock body scroll
  useEffect(() => {
    if (!open) {
      setSearch("");
      document.body.style.overflow = "";
    } else {
      document.body.style.overflow = "hidden";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Full-screen backdrop */}
          <motion.div
            key="agent-picker-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[200] bg-ink/40"
            onClick={onClose}
          />

          {/* Centered modal */}
          <motion.div
            key="agent-picker-modal"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-[201] flex items-center justify-center p-6 pointer-events-none"
          >
            <div className="bg-cream border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[60vh] flex flex-col overflow-hidden pointer-events-auto">
              {/* Header */}
              <div className="px-5 pt-5 pb-3 border-b border-border shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-display italic text-lg text-ink">{label}</h2>
                  <button
                    onClick={onClose}
                    className="p-1.5 rounded-lg hover:bg-cream-dark transition-colors duration-200"
                  >
                    <svg className="w-4 h-4 text-ink-light" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </div>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name or address..."
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-xl border border-ink-light/20 bg-cream-dark/50 font-serif text-[13px] text-ink placeholder:text-ink-light/30 focus:outline-none focus:border-clay/40 transition-colors duration-200"
                />
              </div>

              {/* Agent list */}
              <div className="overflow-y-auto flex-1 p-2">
                {agents.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="font-serif text-[13px] text-ink-light">
                      {search ? "No agents match your search." : "No agents registered yet."}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {agents.map((agent) => (
                      <button
                        key={agent.address}
                        onClick={() => {
                          onSelect(agent.address);
                          onClose();
                        }}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl hover:bg-cream-dark transition-colors duration-150 text-left group"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-serif text-[13px] text-ink group-hover:text-clay transition-colors duration-200 truncate">
                            {agent.name || "Unnamed Agent"}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-[10px] text-ink-light/50">
                              {agent.address.slice(0, 6)}...{agent.address.slice(-4)}
                            </span>
                            {agent.capabilities && (
                              <span className="font-mono text-[9px] text-ink-light/40 truncate">
                                {agent.capabilities}
                              </span>
                            )}
                          </div>
                        </div>
                        <svg className="w-3.5 h-3.5 text-ink-light/20 group-hover:text-clay transition-colors duration-200 shrink-0 ml-2" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M6 4l4 4-4 4" />
                        </svg>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
