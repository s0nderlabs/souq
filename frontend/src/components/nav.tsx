"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { CopyButton } from "./copy-button";
import { useChainSwitch } from "@/hooks/use-chain-switch";
import { useRelay } from "@/hooks/use-relay";

const navLinks = [
  { href: "/jobs", label: "Jobs" },
  { href: "/create", label: "Create" },
  { href: "/agents", label: "Agents" },
  { href: "/faucet", label: "Faucet" },
];

export function Nav() {
  const pathname = usePathname();
  useChainSwitch();
  useRelay();
  const [scrolled, setScrolled] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const walletRef = useRef<HTMLDivElement>(null);
  const { login, logout, authenticated, user } = usePrivy();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close wallet popover on click outside
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (walletRef.current && !walletRef.current.contains(e.target as Node)) {
        setWalletOpen(false);
      }
    };
    if (walletOpen) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [walletOpen]);

  const linkClass = (active: boolean) =>
    `relative font-serif text-[13px] tracking-wide transition-colors duration-300 ${
      active ? "text-clay" : "text-ink-light/60 hover:text-clay"
    }`;

  const dot = (
    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-clay" />
  );

  const displayAddress = user?.wallet?.address
    ? `${user.wallet.address.slice(0, 6)}...${user.wallet.address.slice(-4)}`
    : null;

  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between px-6 pt-3">
      {/* Left spacer for symmetry */}
      <div className="w-32" />

      {/* Center pill */}
      <div
        className={`flex items-center justify-center gap-4 sm:gap-7 px-4 sm:px-6 py-2.5 rounded-full border transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          scrolled
            ? "bg-cream/70 backdrop-blur-xl shadow-[0_1px_8px_rgba(0,0,0,0.06)] border-border/60"
            : "bg-transparent backdrop-blur-none shadow-none border-transparent"
        }`}
      >
        {navLinks.slice(0, 2).map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
          return (
            <Link key={link.href} href={link.href} className={linkClass(isActive)}>
              {link.label}
              {isActive && dot}
            </Link>
          );
        })}

        <Link
          href="/"
          className="font-display italic text-[28px] text-ink tracking-tight leading-none hover:text-clay transition-colors duration-300"
        >
          Souq
        </Link>

        {navLinks.slice(2).map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(link.href + "/");
          return (
            <Link key={link.href} href={link.href} className={linkClass(isActive)}>
              {link.label}
              {isActive && dot}
            </Link>
          );
        })}
      </div>

      {/* Right: Connect button */}
      <div className="w-32 flex justify-end">
        {authenticated ? (
          <div className="relative" ref={walletRef}>
            <button
              onClick={() => setWalletOpen(!walletOpen)}
              className="px-4 py-1.5 rounded-full bg-clay/10 text-clay font-mono text-[12px] tracking-wide hover:bg-clay/15 transition-colors duration-300"
            >
              {displayAddress}
            </button>

            {walletOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 rounded-2xl border border-border bg-cream p-4 shadow-[0_4px_24px_rgba(0,0,0,0.08)]">
                <p className="font-mono text-[10px] text-ink-light tracking-wider mb-2">Wallet</p>
                <div className="flex items-center gap-2 mb-4">
                  <p className="font-mono text-[12px] text-ink truncate flex-1">
                    {user?.wallet?.address}
                  </p>
                  {user?.wallet?.address && <CopyButton text={user.wallet.address} />}
                </div>

                {user?.email?.address && (
                  <div className="mb-4">
                    <p className="font-mono text-[10px] text-ink-light tracking-wider mb-1">Email</p>
                    <p className="font-serif text-[13px] text-ink">{user.email.address}</p>
                  </div>
                )}

                <div className="pt-3 border-t border-border">
                  <button
                    onClick={() => { logout(); setWalletOpen(false); }}
                    className="w-full py-2 rounded-full border border-fail/20 text-fail font-serif text-[13px] hover:bg-fail/[0.04] transition-colors duration-200"
                  >
                    Disconnect
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={login}
            className="px-4 py-1.5 rounded-full border border-border text-ink-light font-serif text-[13px] tracking-wide hover:border-clay/40 hover:text-clay transition-colors duration-300"
          >
            Connect
          </button>
        )}
      </div>
    </nav>
  );
}
