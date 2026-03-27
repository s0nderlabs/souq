"use client";

import { use, useState, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { useReadContract, usePublicClient, useWalletClient, useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { parseUnits } from "viem";
import { useJob, useBids } from "@/hooks/use-job";
import { StatusBadge } from "@/components/status-badge";
import { Address, isZeroAddress } from "@/components/address";
import { ESCROW_ADDRESS, USDT_ADDRESS, USDT_DECIMALS, escrowAbi, usdtAbi, TERMINAL_STATUSES, parseOnChainJobStatus } from "@/lib/contracts";
import { sendRelayEventAsync } from "@/lib/websocket";
import { useEncryption } from "@/hooks/use-encryption";
import { browserDecrypt, type EncryptedPackage } from "@/lib/encryption";
import { relay } from "@/lib/relay";
import { DeliverableViewer } from "@/components/deliverable-viewer";
import { useAgents } from "@/hooks/use-agents";
import { jobDisplayTitle } from "@/lib/format";

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

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const eventLabels: Record<string, string> = {
  "job:created": "Job created",
  "job:budget_set": "Budget set",
  "job:funded": "Job funded",
  "job:provider_set": "Provider assigned",
  "job:submitted": "Work submitted",
  "job:completed": "Job completed",
  "job:rejected": "Job rejected",
  "job:bid": "Bid received",
};

const fadeUp = {
  hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.06 } },
};

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const jobId = Number(id);
  const { data: jobData, isLoading: jobLoading } = useJob(jobId);
  const { data: bidData } = useBids(jobId);
  const { address: userAddress } = useAccount();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [actionStep, setActionStep] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [counterBidder, setCounterBidder] = useState<string | null>(null);
  const [counterAmount, setCounterAmount] = useState("");
  const [counterMessage, setCounterMessage] = useState("");
  const { derive, isReady: encryptionReady, privateKey: encPrivateKey } = useEncryption();
  const [deliverableText, setDeliverableText] = useState<string | null>(null);
  const [deliverableLoading, setDeliverableLoading] = useState(false);
  const [deliverableError, setDeliverableError] = useState<string | null>(null);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const { data: agentsData } = useAgents();

  const agentName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of (agentsData?.agents || [])) {
      if (a.name) map.set(a.address.toLowerCase(), a.name);
    }
    return (addr: string | null) => addr ? map.get(addr.toLowerCase()) || null : null;
  }, [agentsData]);

  // Clear deliverable on wallet change/disconnect
  useEffect(() => {
    setDeliverableText(null);
    setDeliverableError(null);
  }, [userAddress]);

  // Read on-chain status (catches expired jobs the relay misses)
  const { data: onChainJob } = useReadContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName: "getJob",
    args: [BigInt(jobId)],
  });

  if (jobLoading) {
    return (
      <div className="max-w-3xl mx-auto px-6 pt-8 pb-16">
        <div className="h-8 w-48 bg-border/30 rounded-lg animate-pulse mb-4" />
        <div className="h-5 w-96 bg-border/30 rounded-lg animate-pulse mb-8" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-16 bg-border/30 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!jobData) {
    return (
      <div className="max-w-3xl mx-auto px-6 pt-8 pb-16 text-center">
        <p className="font-serif text-ink-light text-lg">Job not found.</p>
        <Link href="/jobs" className="font-serif text-clay text-sm mt-2 inline-block hover:text-clay-light">
          Back to marketplace
        </Link>
      </div>
    );
  }

  // Dedup timeline: relay stores events from multiple agents, same type+timestamp = duplicate
  const timeline = (jobData.timeline || []).filter(
    (event, i, arr) =>
      i === arr.findIndex((e) => e.type === event.type && e.timestamp === event.timestamp)
  );
  const createdEvent = timeline.find((e) => e.type === "job:created");
  const latestEvent = timeline[0];
  const status = (latestEvent?.type?.replace("job:", "") || "open").toLowerCase();

  const client = (createdEvent?.data?.client as string) || null;
  const providerSetEvent = timeline.find((e) => e.type === "job:provider_set");
  const provider = (providerSetEvent?.data?.provider as string) || (createdEvent?.data?.provider as string) || null;
  const evaluator = (createdEvent?.data?.evaluator as string) || null;
  const budgetEvent = timeline.find((e) => e.type === "job:budget_set");
  const budget = (budgetEvent?.data?.amount as string) || null;
  const completedEvent = timeline.find((e) => e.type === "job:completed");
  const payouts = completedEvent?.data?.payouts as Record<string, string> | undefined;

  // Relay status — derived from timeline events, updates in real-time via WebSocket
  const relayStatus = completedEvent
    ? "completed"
    : timeline.find((e) => e.type === "job:rejected")
      ? "rejected"
      : timeline.find((e) => e.type === "job:submitted")
        ? "submitted"
        : timeline.find((e) => e.type === "job:funded")
          ? "funded"
          : "open";

  // On-chain status — fallback for edge cases (expired jobs have no relay event)
  const onChainStatus: string | null = onChainJob
    ? parseOnChainJobStatus(onChainJob)
    : null;

  // On-chain terminal states (completed, rejected, expired) always win — relay events can be lost
  const actualStatus = TERMINAL_STATUSES.has(onChainStatus || "")
    ? onChainStatus!
    : relayStatus !== "open"
      ? relayStatus
      : onChainStatus || relayStatus;

  // Inject synthetic timeline entry if on-chain has a terminal state the relay missed
  if (onChainStatus && TERMINAL_STATUSES.has(onChainStatus)) {
    const hasTerminalEvent = timeline.some(
      (e) => e.type === `job:${onChainStatus}`
    );
    if (!hasTerminalEvent) {
      const lastTs = timeline.length > 0 ? timeline[timeline.length - 1].timestamp : Date.now();
      timeline.push({
        type: `job:${onChainStatus}`,
        data: { synthetic: true },
        timestamp: lastTs + 1,
      });
    }
  }

  const showBids = actualStatus === "open" && isZeroAddress(provider);
  const bids = bidData?.bids || [];

  // Expiry date from on-chain
  const expiryTimestamp = onChainJob
    ? Number(Array.isArray(onChainJob) ? onChainJob[4] : (onChainJob as unknown as Record<string, unknown>).expiredAt ?? 0)
    : 0;
  const expiresAt = expiryTimestamp > 0 ? new Date(expiryTimestamp * 1000) : null;
  const isExpired = expiresAt ? Date.now() > expiresAt.getTime() : false;

  return (
    <div className="max-w-3xl mx-auto px-6 pt-8 pb-16">
      {/* Back link */}
      <Link
        href="/jobs"
        className="inline-flex items-center gap-1.5 font-serif text-[13px] text-ink-light hover:text-clay transition-colors duration-200 mb-6"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10 4l-4 4 4 4" />
        </svg>
        Back to marketplace
      </Link>

      <motion.div initial="hidden" animate="visible" variants={stagger}>
        {/* Header */}
        <motion.div variants={fadeUp} className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <span className="font-mono text-[12px] text-ink-light/50">#{jobId}</span>
            <StatusBadge status={actualStatus} />
          </div>
          <h1 className="font-display italic text-2xl sm:text-3xl text-ink tracking-tight leading-tight">
            {jobDisplayTitle(jobData.title, jobData.description)}
          </h1>
          {jobData.description && (jobData.title || jobData.description.length > 80) && (
            <p className="font-serif text-[14px] text-ink-light leading-relaxed mt-3">
              {jobData.description}
            </p>
          )}
        </motion.div>

        {/* Participants + Budget */}
        <motion.div variants={fadeUp} className="rounded-2xl border border-border p-5 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[
              { label: "Client", addr: client },
              { label: "Evaluator", addr: evaluator },
              { label: "Provider", addr: provider && !isZeroAddress(provider) ? provider : null },
            ].map(({ label, addr }) => {
              if (!addr && label !== "Provider") return null;
              const name = addr ? agentName(addr) : null;
              return (
                <div key={label}>
                  <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1">{label}</p>
                  {!addr ? (
                    <span className="font-mono text-[12px] text-clay/70 italic">Open for bids</span>
                  ) : name ? (
                    <Link href={`/agents/${addr}`} className="font-serif text-[13px] text-ink hover:text-clay transition-colors duration-200">
                      {name}
                      <span className="font-mono text-[10px] text-ink-light/40 ml-1.5">{addr.slice(0, 6)}...{addr.slice(-4)}</span>
                    </Link>
                  ) : (
                    <Address value={addr} />
                  )}
                </div>
              );
            })}
            {budget && (
              <div>
                <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1">Budget</p>
                <p className="font-mono text-[15px] text-ink tabular-nums">
                  {budget} <span className="text-[11px] text-ink-light">USDT</span>
                </p>
              </div>
            )}
            {expiresAt && (
              <div>
                <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1">Expires</p>
                <p className={`font-mono text-[13px] tabular-nums ${isExpired ? "text-fail" : "text-ink"}`}>
                  {expiresAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  {isExpired && <span className="text-[10px] text-fail ml-1.5">Expired</span>}
                </p>
              </div>
            )}
          </div>

          {/* Payouts */}
          {payouts && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-2">Payouts</p>
              <div className="flex gap-6">
                {payouts.provider && (
                  <div>
                    <span className="font-mono text-[10px] text-ink-light/40">Provider</span>
                    <p className="font-mono text-[13px] text-ink tabular-nums">{payouts.provider} USDT</p>
                  </div>
                )}
                {payouts.evaluator && (
                  <div>
                    <span className="font-mono text-[10px] text-ink-light/40">Evaluator</span>
                    <p className="font-mono text-[13px] text-ink tabular-nums">{payouts.evaluator} USDT</p>
                  </div>
                )}
                {payouts.platform && (
                  <div>
                    <span className="font-mono text-[10px] text-ink-light/40">Platform</span>
                    <p className="font-mono text-[13px] text-ink tabular-nums">{payouts.platform} USDT</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>

        {/* Read Deliverable — client can decrypt completed work */}
        {(() => {
          const isClient = userAddress && client && userAddress.toLowerCase() === client.toLowerCase();
          const isCompleted = actualStatus === "completed";
          const completedEvt = timeline.find((e) => e.type === "job:completed");
          const clientCid = (completedEvt?.data?.clientDeliverableCid as string | undefined)
            || (completedEvt?.data?.clientDeliverableUri as string | undefined)?.replace("ipfs://", "");

          if (!isClient || !isCompleted) return null;

          const handleReadDeliverable = async () => {
            setDeliverableError(null);
            setDeliverableLoading(true);
            try {
              // Derive keypair if not ready (triggers wallet signature)
              let privKey = encPrivateKey;
              if (!privKey) {
                const kp = await derive();
                if (!kp) throw new Error("Signature rejected");
                privKey = kp.privateKey;
              }

              if (!clientCid) throw new Error("Deliverable CID not found. The job:completed event may be missing from the relay.");

              // Fetch encrypted package from IPFS
              const ipfsData = await relay.ipfs(clientCid);
              // The IPFS response wraps the package: { type, package: { iv, encryptedContent, ... } }
              const pkg = (ipfsData.package || ipfsData) as EncryptedPackage;
              if (!pkg.iv || !pkg.encryptedContent) throw new Error("Invalid encrypted package");

              // Decrypt in browser
              const plaintext = await browserDecrypt(pkg, privKey);
              setDeliverableText(plaintext);
            } catch (e) {
              setDeliverableError(e instanceof Error ? e.message : "Decryption failed");
            }
            setDeliverableLoading(false);
          };

          return (
            <motion.div variants={fadeUp} className="rounded-2xl border border-clay/30 bg-clay/[0.03] p-5 mb-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display italic text-lg text-ink">Deliverable</h2>
                {deliverableText && (
                  <button
                    onClick={() => setDeliverableText(null)}
                    className="font-serif text-[12px] text-ink-light hover:text-clay transition-colors duration-200"
                  >
                    Close
                  </button>
                )}
              </div>

              <AnimatePresence mode="wait">
                {deliverableText ? (
                  <motion.div
                    key="content"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <DeliverableViewer content={deliverableText} jobId={jobId} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="prompt"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <p className="font-serif text-[13px] text-ink-light mb-4">
                      The deliverable is encrypted. Sign a message with your wallet to decrypt it.
                    </p>

                    {deliverableError && (
                      <p className="font-serif text-[13px] text-fail mb-3">{deliverableError}</p>
                    )}

                    <button
                      onClick={handleReadDeliverable}
                      disabled={deliverableLoading}
                      className="w-full py-2.5 rounded-full bg-clay text-cream font-serif text-[14px] tracking-wide hover:bg-clay-light transition-colors duration-200"
                    >
                      {deliverableLoading ? (
                        <span className="inline-flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-cream/30 border-t-cream rounded-full animate-spin" />
                          Decrypting...
                        </span>
                      ) : "Read Deliverable"}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })()}

        {/* Bids & Negotiation — shown BEFORE job actions so client can accept first */}
        {showBids && (
          <motion.div variants={fadeUp} className="mb-6">
            <h2 className="font-display italic text-lg text-ink mb-3">Bids</h2>
            {bids.length === 0 ? (
              <div className="rounded-2xl border border-border p-5 text-center">
                <p className="font-serif text-ink-light text-sm">No bids yet. Agents can apply via MCP.</p>
              </div>
            ) : (() => {
              // Group bids+counters into negotiation threads per bidder
              const threads = new Map<string, typeof bids>();
              for (const b of bids) {
                const key = b.bidder?.toLowerCase() || b.from?.toLowerCase() || "";
                if (!threads.has(key)) threads.set(key, []);
                threads.get(key)!.push(b);
              }
              const isClient = userAddress && client && userAddress.toLowerCase() === client.toLowerCase();

              return (
                <div className="space-y-3">
                  {[...threads.entries()].map(([bidderAddr, thread]) => (
                    <div key={bidderAddr} className="rounded-xl border border-border p-4">
                      {/* Bidder header */}
                      <div className="flex items-center justify-between mb-3">
                        <Address value={thread[0].bidder || bidderAddr} />
                      </div>

                      {/* Negotiation thread */}
                      <div className="space-y-2">
                        {thread.map((msg, i) => {
                          const isCounter = msg.type === "job:counter";
                          const fromClient = msg.from?.toLowerCase() === client?.toLowerCase();
                          const isBid = !isCounter && !fromClient;
                          return (
                            <div key={i} className={`rounded-lg p-3 ${isCounter ? "bg-clay/[0.06] border border-clay/15" : "bg-cream-dark/50"}`}>
                              <div className="flex items-center justify-between mb-1">
                                <span className="font-mono text-[10px] text-ink-light/50">
                                  {fromClient ? "Client" : "Provider"} {isCounter ? "countered" : "bid"}
                                </span>
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[13px] text-ink tabular-nums">
                                    {msg.proposedBudget} <span className="text-[11px] text-ink-light">USDT</span>
                                  </span>
                                  {isClient && isBid && (
                                    <button
                                      onClick={async () => {
                                        if (!walletClient || !publicClient) return;
                                        setActionError(null);
                                        setActionStep("Accepting bid...");
                                        try {
                                          const addr = (msg.bidder || bidderAddr) as `0x${string}`;
                                          const bidAmount = parseUnits(msg.proposedBudget, USDT_DECIMALS);

                                          // 1. Set provider
                                          const provHash = await walletClient.writeContract({
                                            address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "setProvider",
                                            args: [BigInt(jobId), addr, "0x"],
                                          });
                                          await publicClient.waitForTransactionReceipt({ hash: provHash });
                                          await sendRelayEventAsync({ type: "job:provider_set", jobId, data: { provider: addr } });

                                          // 2. Set budget to bid amount
                                          setActionStep("Setting budget...");
                                          const budgetHash = await walletClient.writeContract({
                                            address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "setBudget",
                                            args: [BigInt(jobId), bidAmount, "0x"],
                                          });
                                          await publicClient.waitForTransactionReceipt({ hash: budgetHash });
                                          await sendRelayEventAsync({ type: "job:budget_set", jobId, data: { amount: msg.proposedBudget } });

                                          // 3. Approve USDT
                                          setActionStep("Approving USDT...");
                                          const approveHash = await walletClient.writeContract({
                                            address: USDT_ADDRESS, abi: usdtAbi, functionName: "approve",
                                            args: [ESCROW_ADDRESS, bidAmount],
                                          });
                                          await publicClient.waitForTransactionReceipt({ hash: approveHash });

                                          // 4. Fund
                                          setActionStep("Funding escrow...");
                                          const fundHash = await walletClient.writeContract({
                                            address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "fund",
                                            args: [BigInt(jobId), bidAmount, "0x"],
                                          });
                                          await publicClient.waitForTransactionReceipt({ hash: fundHash });
                                          await sendRelayEventAsync({ type: "job:funded", jobId, data: { budget: msg.proposedBudget } });

                                          setActionStep(null);
                                          queryClient.invalidateQueries({ queryKey: ["job", jobId] }); queryClient.invalidateQueries({ queryKey: ["bids", jobId] }); queryClient.invalidateQueries({ queryKey: ["jobs"] });
                                        } catch (e) {
                                          const msg2 = e instanceof Error ? e.message : "Failed";
                                          setActionError(msg2.includes("rejected") ? "Transaction rejected." : msg2.slice(0, 100));
                                          setActionStep(null);
                                        }
                                      }}
                                      disabled={!!actionStep}
                                      className="px-3 py-1 rounded-full bg-clay text-cream font-serif text-[11px] hover:bg-clay-light transition-colors duration-200"
                                    >
                                      {actionStep ? "..." : "Accept"}
                                    </button>
                                  )}
                                </div>
                              </div>
                              {msg.pitch && (
                                <p className="font-serif text-[12px] text-ink-light leading-relaxed">{msg.pitch}</p>
                              )}
                              <p className="font-mono text-[9px] text-ink-light/30 mt-1">{timeAgo(msg.timestamp)}</p>
                            </div>
                          );
                        })}
                      </div>

                      {/* Counter-offer form (client only) */}
                      {isClient && (
                        <div className="mt-3">
                          {counterBidder === bidderAddr ? (
                            <div className="space-y-2">
                              <div className="flex gap-2">
                                <input
                                  value={counterAmount}
                                  onChange={(e) => setCounterAmount(e.target.value)}
                                  type="number"
                                  placeholder="Your price"
                                  className="flex-1 px-3 py-2 rounded-lg border border-ink-light/20 bg-transparent font-mono text-[13px] text-ink placeholder:text-ink-light/30 focus:outline-none focus:border-clay/40"
                                />
                                <span className="font-mono text-[11px] text-ink-light self-center">USDT</span>
                              </div>
                              <input
                                value={counterMessage}
                                onChange={(e) => setCounterMessage(e.target.value)}
                                placeholder="Message (optional)"
                                className="w-full px-3 py-2 rounded-lg border border-ink-light/20 bg-transparent font-serif text-[12px] text-ink placeholder:text-ink-light/30 focus:outline-none focus:border-clay/40"
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={async () => {
                                    if (!counterAmount || Number(counterAmount) <= 0) return;
                                    await sendRelayEventAsync({
                                      type: "job:counter",
                                      jobId,
                                      to: thread[0].bidder || bidderAddr,
                                      data: {
                                        proposedBudget: counterAmount,
                                        message: counterMessage || undefined,
                                        bidder: thread[0].bidder || bidderAddr,
                                        client: userAddress,
                                      },
                                    });
                                    setCounterBidder(null);
                                    setCounterAmount("");
                                    setCounterMessage("");
                                    queryClient.invalidateQueries({ queryKey: ["job", jobId] }); queryClient.invalidateQueries({ queryKey: ["bids", jobId] }); queryClient.invalidateQueries({ queryKey: ["jobs"] });
                                  }}
                                  className="px-4 py-1.5 rounded-full bg-clay text-cream font-serif text-[12px] hover:bg-clay-light transition-colors duration-200"
                                >
                                  Send Counter
                                </button>
                                <button
                                  onClick={() => { setCounterBidder(null); setCounterAmount(""); setCounterMessage(""); }}
                                  className="px-4 py-1.5 rounded-full border border-border font-serif text-[12px] text-ink-light hover:text-ink transition-colors duration-200"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setCounterBidder(bidderAddr)}
                              className="font-serif text-[12px] text-clay hover:text-clay-light transition-colors duration-200"
                            >
                              Counter-offer
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })()}
          </motion.div>
        )}

        {/* Job Actions — resume interrupted flow */}
        {(() => {
          const isClient = userAddress && client && userAddress.toLowerCase() === client.toLowerCase();
          const hasProvider = provider && !isZeroAddress(provider);
          const needsBudget = actualStatus === "open" && !budget;
          const needsFunding = actualStatus === "open" && budget;

          if (!isClient || !["open"].includes(actualStatus)) return null;

          const handleResume = async () => {
            if (!walletClient || !publicClient) return;
            setActionError(null);

            try {
              if (!hasProvider) {
                // No provider — only set budget (proposed price), no fund
                if (!budgetInput || Number(budgetInput) <= 0) {
                  setActionError("Enter a budget amount.");
                  return;
                }
                const amount = parseUnits(budgetInput, USDT_DECIMALS);
                setActionStep("Setting proposed price...");
                const hash = await walletClient.writeContract({
                  address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "setBudget",
                  args: [BigInt(jobId), amount, "0x"],
                });
                await publicClient.waitForTransactionReceipt({ hash });
                await sendRelayEventAsync({ type: "job:budget_set", jobId, data: { amount: budgetInput } });
                setActionStep(null);
                queryClient.invalidateQueries({ queryKey: ["job", jobId] }); queryClient.invalidateQueries({ queryKey: ["bids", jobId] }); queryClient.invalidateQueries({ queryKey: ["jobs"] });
              } else if (needsBudget) {
                // Has provider, no budget — full flow
                if (!budgetInput || Number(budgetInput) <= 0) {
                  setActionError("Enter a budget amount.");
                  return;
                }
                const amount = parseUnits(budgetInput, USDT_DECIMALS);

                setActionStep("Setting budget...");
                const budgetHash = await walletClient.writeContract({
                  address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "setBudget",
                  args: [BigInt(jobId), amount, "0x"],
                });
                await publicClient.waitForTransactionReceipt({ hash: budgetHash });

                setActionStep("Approving USDT...");
                const approveHash = await walletClient.writeContract({
                  address: USDT_ADDRESS, abi: usdtAbi, functionName: "approve",
                  args: [ESCROW_ADDRESS, amount],
                });
                await publicClient.waitForTransactionReceipt({ hash: approveHash });

                setActionStep("Funding escrow...");
                const fundHash = await walletClient.writeContract({
                  address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "fund",
                  args: [BigInt(jobId), amount, "0x"],
                });
                await publicClient.waitForTransactionReceipt({ hash: fundHash });

                await sendRelayEventAsync({ type: "job:budget_set", jobId, data: { amount: budgetInput } });
                await sendRelayEventAsync({ type: "job:funded", jobId, data: { budget: budgetInput } });
                setActionStep(null);
                queryClient.invalidateQueries({ queryKey: ["job", jobId] }); queryClient.invalidateQueries({ queryKey: ["bids", jobId] }); queryClient.invalidateQueries({ queryKey: ["jobs"] });
              } else if (needsFunding) {
                // Has provider, has budget — approve + fund only
                const onChainBudget = onChainJob ? (onChainJob as unknown as unknown[])[3] as bigint : parseUnits(budget!, USDT_DECIMALS);

                setActionStep("Approving USDT...");
                const approveHash = await walletClient.writeContract({
                  address: USDT_ADDRESS, abi: usdtAbi, functionName: "approve",
                  args: [ESCROW_ADDRESS, onChainBudget],
                });
                await publicClient.waitForTransactionReceipt({ hash: approveHash });

                setActionStep("Funding escrow...");
                const fundHash = await walletClient.writeContract({
                  address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "fund",
                  args: [BigInt(jobId), onChainBudget, "0x"],
                });
                await publicClient.waitForTransactionReceipt({ hash: fundHash });

                await sendRelayEventAsync({ type: "job:funded", jobId, data: { budget: budget! } });
                setActionStep(null);
                queryClient.invalidateQueries({ queryKey: ["job", jobId] }); queryClient.invalidateQueries({ queryKey: ["bids", jobId] }); queryClient.invalidateQueries({ queryKey: ["jobs"] });
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Failed";
              setActionError(msg.includes("rejected") ? "Transaction rejected." : msg.slice(0, 100));
              setActionStep(null);
            }
          };

          return (
            <motion.div variants={fadeUp} className="rounded-2xl border border-clay/30 bg-clay/[0.03] p-5 mb-6">
              <h2 className="font-display italic text-lg text-ink mb-3">
                {!hasProvider ? "Set Proposed Price" : needsBudget ? "Set Budget & Fund" : "Fund Job"}
              </h2>

              {!hasProvider && (
                <p className="font-serif text-[11px] text-ink-light/50 mb-3">
                  Set a proposed price for agents to accept or counter-bid. Assign a provider from the bids above to fund.
                </p>
              )}

              {(needsBudget || !hasProvider) && (
                <div className="mb-4">
                  <label className="font-mono text-[11px] text-ink-light tracking-wide block mb-2">
                    {hasProvider ? "Budget (USDT)" : "Proposed Price (USDT)"}
                  </label>
                  <input
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    type="number"
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl border border-ink-light/20 bg-transparent font-mono text-[15px] text-ink placeholder:text-ink-light/30 focus:outline-none focus:border-clay/40 transition-colors duration-200 tabular-nums"
                  />
                </div>
              )}

              {needsFunding && hasProvider && (
                <p className="font-serif text-[13px] text-ink-light mb-4">
                  Budget is set to {budget} USDT. Approve and fund the escrow to activate this job.
                </p>
              )}

              {actionError && (
                <p className="font-serif text-[13px] text-fail mb-3">{actionError}</p>
              )}

              <button
                onClick={handleResume}
                disabled={!!actionStep}
                className="w-full py-2.5 rounded-full bg-clay text-cream font-serif text-[14px] tracking-wide hover:bg-clay-light transition-colors duration-200"
              >
                {actionStep ? (
                  <span className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-cream/30 border-t-cream rounded-full animate-spin" />
                    {actionStep}
                  </span>
                ) : !hasProvider ? "Set Proposed Price" : needsBudget ? "Set Budget & Fund" : "Approve & Fund"}
              </button>
            </motion.div>
          );
        })()}

        {/* Timeline */}
        <motion.div variants={fadeUp}>
          <h2 className="font-display italic text-lg text-ink mb-3">Timeline</h2>
          {timeline.length === 0 ? (
            <div className="rounded-2xl border border-border p-5 text-center">
              <p className="font-serif text-ink-light text-sm">No events recorded yet.</p>
            </div>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

              <div className="space-y-0">
                {(() => {
                  const reversed = [...timeline].reverse();
                  const visible = timelineExpanded ? reversed : reversed.slice(0, 3);
                  return visible;
                })().map((event, i) => (
                  <div key={i} className="relative pl-7 pb-5 last:pb-0">
                    {/* Dot */}
                    <div className="absolute left-0 top-1.5 w-[15px] h-[15px] rounded-full border-2 border-border bg-cream flex items-center justify-center">
                      <div className={`w-[5px] h-[5px] rounded-full ${
                        event.type === "job:completed" ? "bg-emerald-500" :
                        event.type === "job:rejected" ? "bg-fail" :
                        "bg-clay"
                      }`} />
                    </div>

                    <div>
                      <div className="flex items-center gap-3">
                        <p className="font-serif text-[13px] text-ink">
                          {eventLabels[event.type] || event.type}
                        </p>
                        <span className="font-mono text-[10px] text-ink-light/40">
                          {formatTimestamp(event.timestamp)}
                        </span>
                      </div>

                      {event.type === "job:budget_set" && event.data?.amount != null && (
                        <p className="font-mono text-[12px] text-ink-light mt-0.5">
                          {String(event.data.amount)} USDT
                        </p>
                      )}
                      {event.type === "job:bid" && event.data?.bidder != null && (
                        <p className="font-mono text-[12px] text-ink-light mt-0.5">
                          by {String(event.data.bidder).slice(0, 10)}... — {String(event.data.proposedBudget)} USDT
                        </p>
                      )}
                      {event.type === "job:completed" && event.data?.reason != null && (
                        <p className="font-serif text-[12px] text-ink-light mt-0.5 italic">
                          &ldquo;{String(event.data.reason)}&rdquo;
                        </p>
                      )}
                      {event.type === "job:rejected" && event.data?.reason != null && (
                        <p className="font-serif text-[12px] text-fail/80 mt-0.5 italic">
                          &ldquo;{String(event.data.reason)}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {timeline.length > 3 && !timelineExpanded && (
                <button
                  onClick={() => setTimelineExpanded(true)}
                  className="mt-3 ml-7 font-serif text-[12px] text-clay hover:text-clay-light transition-colors duration-200"
                >
                  Show all {timeline.length} events
                </button>
              )}
              {timelineExpanded && timeline.length > 3 && (
                <button
                  onClick={() => setTimelineExpanded(false)}
                  className="mt-3 ml-7 font-serif text-[12px] text-ink-light hover:text-ink transition-colors duration-200"
                >
                  Show less
                </button>
              )}
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
