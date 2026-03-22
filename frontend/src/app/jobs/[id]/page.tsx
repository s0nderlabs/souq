"use client";

import { use, useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useReadContract, usePublicClient, useWalletClient, useAccount } from "wagmi";
import { parseUnits } from "viem";
import { useJob, useBids } from "@/hooks/use-job";
import { StatusBadge } from "@/components/status-badge";
import { Address, isZeroAddress } from "@/components/address";
import { ESCROW_ADDRESS, USDT_ADDRESS, USDT_DECIMALS, escrowAbi, usdtAbi, JOB_STATUS } from "@/lib/contracts";
import { sendRelayEventAsync } from "@/lib/websocket";
import { useEncryption } from "@/hooks/use-encryption";
import { browserDecrypt, type EncryptedPackage } from "@/lib/encryption";
import { relay } from "@/lib/relay";
import { DeliverableViewer } from "@/components/deliverable-viewer";

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
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [actionStep, setActionStep] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const { derive, isReady: encryptionReady, privateKey: encPrivateKey } = useEncryption();
  const [deliverableText, setDeliverableText] = useState<string | null>(null);
  const [deliverableLoading, setDeliverableLoading] = useState(false);
  const [deliverableError, setDeliverableError] = useState<string | null>(null);

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
  const provider = (createdEvent?.data?.provider as string) || null;
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
  let onChainStatus: string | null = null;
  if (onChainJob) {
    const jobResult = onChainJob as unknown;
    const statusVal = Array.isArray(jobResult)
      ? Number(jobResult[8])
      : Number((jobResult as Record<string, unknown>).status ?? (jobResult as unknown[])[8] ?? 0);
    onChainStatus = JOB_STATUS[statusVal]?.toLowerCase() || "open";
  }

  // Relay first (real-time), on-chain only for expired/edge cases
  const actualStatus = relayStatus !== "open" ? relayStatus
    : onChainStatus === "expired" ? "expired"
    : onChainStatus || relayStatus;

  const showBids = actualStatus === "open" && isZeroAddress(provider);
  const bids = bidData?.bids || [];

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
            {jobData.description || "Untitled job"}
          </h1>
        </motion.div>

        {/* Participants + Budget */}
        <motion.div variants={fadeUp} className="rounded-2xl border border-border p-5 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {client && (
              <div>
                <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1">Client</p>
                <Address value={client} />
              </div>
            )}
            {evaluator && (
              <div>
                <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1">Evaluator</p>
                <Address value={evaluator} />
              </div>
            )}
            {provider && !isZeroAddress(provider) ? (
              <div>
                <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1">Provider</p>
                <Address value={provider} />
              </div>
            ) : (
              <div>
                <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1">Provider</p>
                <span className="font-mono text-[12px] text-clay/70 italic">Open for bids</span>
              </div>
            )}
            {budget && (
              <div>
                <p className="font-mono text-[10px] text-ink-light/50 tracking-wider mb-1">Budget</p>
                <p className="font-mono text-[15px] text-ink tabular-nums">
                  {budget} <span className="text-[11px] text-ink-light">USDT</span>
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
              <h2 className="font-display italic text-lg text-ink mb-3">Deliverable</h2>

              {deliverableText ? (
                <DeliverableViewer content={deliverableText} jobId={jobId} />
              ) : (
                <>
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
                </>
              )}
            </motion.div>
          );
        })()}

        {/* Job Actions — resume interrupted flow */}
        {(() => {
          // Only show to the job client
          const isClient = userAddress && client && userAddress.toLowerCase() === client.toLowerCase();
          const needsBudget = actualStatus === "open" && !budget;
          const needsFunding = actualStatus === "open" && budget;

          if (!isClient || !["open"].includes(actualStatus)) return null;

          const handleResume = async () => {
            if (!walletClient || !publicClient) return;
            setActionError(null);

            try {
              if (needsBudget) {
                if (!budgetInput || Number(budgetInput) <= 0) {
                  setActionError("Enter a budget amount.");
                  return;
                }
                const amount = parseUnits(budgetInput, USDT_DECIMALS);

                // Set Budget
                setActionStep("Setting budget...");
                const budgetHash = await walletClient.writeContract({
                  address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "setBudget",
                  args: [BigInt(jobId), amount, "0x"],
                });
                await publicClient.waitForTransactionReceipt({ hash: budgetHash });

                // Approve
                setActionStep("Approving USDT...");
                const approveHash = await walletClient.writeContract({
                  address: USDT_ADDRESS, abi: usdtAbi, functionName: "approve",
                  args: [ESCROW_ADDRESS, amount],
                });
                await publicClient.waitForTransactionReceipt({ hash: approveHash });

                // Fund
                setActionStep("Funding escrow...");
                const fundHash = await walletClient.writeContract({
                  address: ESCROW_ADDRESS, abi: escrowAbi, functionName: "fund",
                  args: [BigInt(jobId), amount, "0x"],
                });
                await publicClient.waitForTransactionReceipt({ hash: fundHash });

                // Broadcast
                await sendRelayEventAsync({ type: "job:budget_set", jobId, data: { amount: budgetInput } });
                await sendRelayEventAsync({ type: "job:funded", jobId, data: { budget: budgetInput } });

                setActionStep(null);
                window.location.reload();
              } else if (needsFunding) {
                // Budget already set, just approve + fund
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
                window.location.reload();
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
                {needsBudget ? "Set Budget & Fund" : "Fund Job"}
              </h2>

              {needsBudget && (
                <div className="mb-4">
                  <label className="font-mono text-[11px] text-ink-light tracking-wide block mb-2">Budget (USDT)</label>
                  <input
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    type="number"
                    placeholder="0.00"
                    className="w-full px-4 py-3 rounded-xl border border-ink-light/20 bg-transparent font-mono text-[15px] text-ink placeholder:text-ink-light/30 focus:outline-none focus:border-clay/40 transition-colors duration-200 tabular-nums"
                  />
                </div>
              )}

              {needsFunding && !needsBudget && (
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
                ) : needsBudget ? "Set Budget & Fund" : "Approve & Fund"}
              </button>
            </motion.div>
          );
        })()}

        {/* Bids (Type 2 open jobs) */}
        {showBids && (
          <motion.div variants={fadeUp} className="mb-6">
            <h2 className="font-display italic text-lg text-ink mb-3">Bids</h2>
            {bids.length === 0 ? (
              <div className="rounded-2xl border border-border p-5 text-center">
                <p className="font-serif text-ink-light text-sm">No bids yet. Agents can apply via MCP.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {bids.map((bid, i) => (
                  <div key={i} className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between mb-2">
                      <Address value={bid.bidder} />
                      <span className="font-mono text-[13px] text-ink tabular-nums">
                        {bid.proposedBudget} <span className="text-[11px] text-ink-light">USDT</span>
                      </span>
                    </div>
                    <p className="font-serif text-[13px] text-ink-light leading-relaxed">{bid.pitch}</p>
                    <p className="font-mono text-[10px] text-ink-light/40 mt-2">{timeAgo(bid.timestamp)}</p>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

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
                {[...timeline].reverse().map((event, i) => (
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
            </div>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
