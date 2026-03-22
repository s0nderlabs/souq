"use client";

import { CopyButton } from "./copy-button";

export function Address({ value, className = "" }: { value: string; className?: string }) {
  const truncated = `${value.slice(0, 6)}...${value.slice(-4)}`;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className="font-mono text-[12px] text-ink-light">{truncated}</span>
      <CopyButton text={value} />
    </span>
  );
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function isZeroAddress(addr: string | null | undefined): boolean {
  return !addr || addr === ZERO_ADDRESS;
}
