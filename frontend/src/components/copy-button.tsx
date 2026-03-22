"use client";

import { useState } from "react";

export function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button onClick={copy} className={`transition-colors duration-200 ${className}`}>
      {copied ? (
        <svg className="w-3.5 h-3.5 text-clay" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 8l3 3 7-7" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5 text-ink-light/40 hover:text-ink-light" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5" y="5" width="8" height="8" rx="1.5" />
          <path d="M3 11V3h8" />
        </svg>
      )}
    </button>
  );
}
