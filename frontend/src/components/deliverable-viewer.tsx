"use client";

import { useState } from "react";
import { Streamdown } from "streamdown";

export function DeliverableViewer({ content, jobId }: { content: string; jobId: number }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `souq-job-${jobId}-deliverable.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-2 mb-3">
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border font-mono text-[11px] text-ink-light hover:border-clay/40 hover:text-clay transition-colors duration-200"
        >
          {copied ? (
            <>
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8l3 3 7-7" /></svg>
              Copied
            </>
          ) : (
            <>
              <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="5" y="5" width="8" height="8" rx="1.5" /><path d="M3 11V3h8" /></svg>
              Copy
            </>
          )}
        </button>
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border font-mono text-[11px] text-ink-light hover:border-clay/40 hover:text-clay transition-colors duration-200"
        >
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M8 2v9M4 8l4 4 4-4" />
            <path d="M2 13h12" />
          </svg>
          Download
        </button>
      </div>

      {/* Rendered markdown */}
      <div className="deliverable-content rounded-xl border border-border bg-cream p-5">
        <Streamdown parseIncompleteMarkdown={false}>
          {content}
        </Streamdown>
      </div>
    </div>
  );
}
