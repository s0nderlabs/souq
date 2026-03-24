"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { useChainId } from "wagmi";
import { sepolia } from "wagmi/chains";
import { useWallets } from "@privy-io/react-auth";
import { zeroAddress, keccak256, toHex, encodePacked, parseUnits, decodeEventLog } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";
import { ESCROW_ADDRESS, USDT_ADDRESS, USDT_DECIMALS, escrowAbi, usdtAbi } from "@/lib/contracts";
import { PageHeader } from "@/components/page-header";
import { AgentPicker } from "@/components/agent-picker";
import { sendRelayEventAsync } from "@/lib/websocket";

const SIGIL_HOOK = "0xEB5d16A2A2617e22ffDD85CD75f709E5eF0fb2EF";

const fadeUp = {
  hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

type JobType = "direct" | "open";
type Step = "form" | "creating" | "setting_budget" | "approving" | "funding" | "broadcasting" | "done" | "error";

const stepLabels: Record<Step, string> = {
  form: "",
  creating: "Creating job on-chain...",
  setting_budget: "Setting budget...",
  approving: "Approving USDT...",
  funding: "Funding escrow...",
  broadcasting: "Notifying agents...",
  done: "",
  error: "",
};

const stepNumbers: Partial<Record<Step, number>> = {
  creating: 1,
  setting_budget: 2,
  approving: 3,
  funding: 4,
  broadcasting: 5,
};

export default function CreateJobPage() {
  const { authenticated, login, ready, user } = usePrivy();
  const { wallets } = useWallets();
  const [evalPickerOpen, setEvalPickerOpen] = useState(false);
  const [provPickerOpen, setProvPickerOpen] = useState(false);
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const isWrongChain = chainId !== sepolia.id;

  const [jobType, setJobType] = useState<JobType>("direct");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [evaluator, setEvaluator] = useState("");
  const [provider, setProvider] = useState("");
  const [budget, setBudget] = useState("");
  const [enableCompliance, setEnableCompliance] = useState(false);
  const [policyId, setPolicyId] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [jobId, setJobId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!authenticated) { login(); return; }
    if (!walletClient || !publicClient) return;

    if (isWrongChain) {
      const wallet = wallets.find((w) => w.address === user?.wallet?.address) || wallets[0];
      if (wallet) wallet.switchChain(sepolia.id);
      setError("Please switch to Sepolia testnet first.");
      return;
    }

    const missing: string[] = [];
    if (!description.trim()) missing.push("Description");
    if (!evaluator.trim()) missing.push("Evaluator Address");
    if (jobType === "direct" && !provider.trim()) missing.push("Provider Address");
    if (jobType === "direct" && (!budget.trim() || Number(budget) <= 0)) missing.push("Budget");
    if (enableCompliance && !policyId.trim()) missing.push("Policy ID");

    if (missing.length > 0) {
      setError(`Please fill in: ${missing.join(", ")}`);
      return;
    }

    setError(null);
    const hasBudget = budget.trim() && Number(budget) > 0;
    const budgetAmount = hasBudget ? parseUnits(budget, USDT_DECIMALS) : BigInt(0);
    const descHash = keccak256(toHex(description));
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 3600);
    const providerAddr = jobType === "direct" ? (provider as `0x${string}`) : zeroAddress;
    const hookAddr = enableCompliance ? (SIGIL_HOOK as `0x${string}`) : zeroAddress;
    const optParams = enableCompliance && policyId
      ? encodePacked(["uint256"], [BigInt(policyId)])
      : "0x" as `0x${string}`;

    try {
      // Step 1: Create Job
      setStep("creating");
      const createHash = await walletClient.writeContract({
        address: ESCROW_ADDRESS,
        abi: escrowAbi,
        functionName: "createJob",
        args: [providerAddr, evaluator as `0x${string}`, expiry, descHash, hookAddr, optParams],
      });
      const createReceipt = await publicClient.waitForTransactionReceipt({ hash: createHash });

      // Parse jobId from JobCreated event
      let parsedJobId: number | undefined;
      for (const log of createReceipt.logs) {
        if (log.address.toLowerCase() === ESCROW_ADDRESS.toLowerCase()) {
          try {
            const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
            if (decoded.eventName === "JobCreated" && decoded.args) {
              parsedJobId = Number((decoded.args as { jobId: bigint }).jobId);
              break;
            }
          } catch { /* not matching */ }
        }
      }

      if (!parsedJobId) throw new Error("Failed to parse jobId from receipt");
      setJobId(parsedJobId);

      // Open Market with budget: set proposed price, skip approve/fund (fund after provider assigned)
      // Open Market without budget: skip everything (agents propose their own price)
      if (jobType === "open" && hasBudget) {
        setStep("setting_budget");
        await walletClient.writeContract({
          address: ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName: "setBudget",
          args: [BigInt(parsedJobId), budgetAmount, "0x"],
        }).then((h) => publicClient.waitForTransactionReceipt({ hash: h }));
      }

      if (jobType === "direct") {
        // Step 2: Set Budget
        setStep("setting_budget");
        const budgetHash = await walletClient.writeContract({
          address: ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName: "setBudget",
          args: [BigInt(parsedJobId), budgetAmount, "0x"],
        });
        await publicClient.waitForTransactionReceipt({ hash: budgetHash });

        // Step 3: Approve USDT
        setStep("approving");
        const approveHash = await walletClient.writeContract({
          address: USDT_ADDRESS,
          abi: usdtAbi,
          functionName: "approve",
          args: [ESCROW_ADDRESS, budgetAmount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });

        // Step 4: Fund Escrow
        setStep("funding");
        const fundHash = await walletClient.writeContract({
          address: ESCROW_ADDRESS,
          abi: escrowAbi,
          functionName: "fund",
          args: [BigInt(parsedJobId), budgetAmount, "0x"],
        });
        await publicClient.waitForTransactionReceipt({ hash: fundHash });
      }

      // Step 5: Broadcast relay event
      setStep("broadcasting");
      const walletAddr = user?.wallet?.address || "";
      await sendRelayEventAsync({
        type: "job:created",
        jobId: parsedJobId,
        data: {
          client: walletAddr,
          provider: jobType === "direct" ? provider : "",
          evaluator,
          ...(title.trim() ? { title: title.trim() } : {}),
          description,
          descriptionCid: descHash,
          txHash: createHash,
        },
      });
      if (jobType === "direct") {
        await sendRelayEventAsync({
          type: "job:budget_set",
          jobId: parsedJobId,
          data: { amount: budget },
        });
        await sendRelayEventAsync({
          type: "job:funded",
          jobId: parsedJobId,
          data: { budget },
        });
      }

      setStep("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      setError(msg.includes("User rejected") || msg.includes("rejected")
        ? "Transaction rejected."
        : `Failed: ${msg.slice(0, 100)}`);
      setStep("error");
    }
  }, [authenticated, login, walletClient, publicClient, isWrongChain, wallets, user, title, description, evaluator, provider, budget, jobType, enableCompliance, policyId]);

  const handleReset = () => {
    setStep("form");
    setError(null);
    setTitle("");
    setDescription("");
    setEvaluator("");
    setProvider("");
    setBudget("");
    setJobId(null);
  };

  // Loading state while Privy initializes
  if (!ready) {
    return (
      <div className="max-w-2xl mx-auto px-6 pt-8 pb-16">
        <PageHeader title="Create Job" subtitle="Post a job for AI agents to complete." />
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-clay/30 border-t-clay rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (ready && !authenticated) {
    return (
      <div className="max-w-2xl mx-auto px-6 pt-8 pb-16">
        <PageHeader title="Create Job" subtitle="Post a job for AI agents to complete." />
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
          <p className="font-serif text-ink-light mb-4">Connect your wallet to create a job.</p>
          <button
            onClick={login}
            className="px-6 py-2.5 rounded-full bg-clay text-cream font-serif text-[14px] tracking-wide hover:bg-clay-light transition-colors duration-200"
          >
            Connect Wallet
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 pt-8 pb-16">
      <PageHeader title="Create Job" subtitle="Post a job for AI agents to complete." />

      <motion.div initial="hidden" animate="visible" variants={stagger}>
        {/* Job type toggle */}
        <motion.div variants={fadeUp} className="flex justify-center mb-8">
          <div className="inline-flex rounded-full border border-border p-1">
            {(["direct", "open"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setJobType(t)}
                disabled={step !== "form" && step !== "error"}
                className="relative px-5 py-2 rounded-full font-serif text-[13px] tracking-wide"
              >
                {jobType === t && (
                  <motion.span
                    layoutId="type-pill"
                    className="absolute inset-0 rounded-full bg-clay"
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  />
                )}
                <span className={`relative z-10 transition-colors duration-200 ${jobType === t ? "text-cream" : "text-ink-light hover:text-ink"}`}>
                  {t === "direct" ? "Direct Assignment" : "Open Market"}
                </span>
              </button>
            ))}
          </div>
        </motion.div>

        {/* Success state */}
        {step === "done" ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="text-center py-16">
            <svg className="w-12 h-12 mx-auto mb-4 text-clay" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12l2.5 2.5L16 9" />
            </svg>
            <p className="font-display italic text-xl text-ink mb-2">
              {jobType === "direct" ? "Job Created & Funded" : "Job Posted"}
            </p>
            <p className="font-serif text-ink-light text-sm mb-2">
              {jobType === "direct"
                ? `Job #${jobId} is live and funded with ${budget} USDT.`
                : `Job #${jobId} is posted. Agents can bid via MCP. Fund after assigning a provider.`}
            </p>
            <p className="font-serif text-[12px] text-ink-light/50 mb-6">
              Agents have been notified and can start working.
            </p>
            <div className="flex justify-center gap-4">
              <Link
                href={jobId ? `/jobs/${jobId}` : "/jobs"}
                className="inline-flex items-center gap-2 font-serif text-clay hover:text-clay-light transition-colors duration-200"
              >
                View job
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 8h10M9 4l4 4-4 4" />
                </svg>
              </Link>
              <button onClick={handleReset} className="font-serif text-[13px] text-ink-light hover:text-ink transition-colors duration-200">
                Create another
              </button>
            </div>
          </motion.div>

        /* In-progress stepper */
        ) : step !== "form" && step !== "error" ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-12">
            {/* Progress steps */}
            <div className="flex items-center justify-center gap-2 mb-8">
              {[1, 2, 3, 4, 5].map((n) => {
                const current = stepNumbers[step] || 0;
                const isActive = n === current;
                const isDone = n < current;
                return (
                  <div key={n} className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-mono text-[11px] transition-colors duration-300 ${
                      isDone ? "bg-clay text-cream" :
                      isActive ? "bg-clay/20 text-clay border-2 border-clay" :
                      "bg-border/50 text-ink-light/40"
                    }`}>
                      {isDone ? (
                        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8l3 3 7-7" /></svg>
                      ) : n}
                    </div>
                    {n < 5 && <div className={`w-6 h-px ${n < (stepNumbers[step] || 0) ? "bg-clay" : "bg-border"}`} />}
                  </div>
                );
              })}
            </div>

            <div className="text-center">
              <div className="w-8 h-8 mx-auto mb-4 border-2 border-clay/30 border-t-clay rounded-full animate-spin" />
              <p className="font-serif text-ink-light">{stepLabels[step]}</p>
              <p className="font-serif text-[12px] text-ink-light/40 mt-2">
                Confirm each transaction in your wallet.
              </p>
            </div>
          </motion.div>

        /* Form + error state */
        ) : (
          <>
            {/* Title */}
            <motion.div variants={fadeUp} className="mb-5">
              <label className="font-mono text-[11px] text-ink-light tracking-wide block mb-2">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="A short title for this job"
                maxLength={80}
                className="w-full px-4 py-3 rounded-xl border border-ink-light/20 bg-transparent font-serif text-[14px] text-ink placeholder:text-ink-light/30 focus:outline-none focus:border-clay/40 transition-colors duration-200"
              />
              <p className="font-serif text-[11px] text-ink-light/40 mt-1.5">Optional. Used as the job heading.</p>
            </motion.div>

            {/* Description */}
            <motion.div variants={fadeUp} className="mb-5">
              <label className="font-mono text-[11px] text-ink-light tracking-wide block mb-2">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the work you need done..."
                rows={4}
                className="w-full px-4 py-3 rounded-xl border border-ink-light/20 bg-transparent font-serif text-[14px] text-ink placeholder:text-ink-light/30 focus:outline-none focus:border-clay/40 transition-colors duration-200 resize-none"
              />
            </motion.div>

            {/* Evaluator */}
            <motion.div variants={fadeUp} className="mb-5">
              <label className="font-mono text-[11px] text-ink-light tracking-wide block mb-2">Evaluator Address</label>
              <div className="flex gap-2">
                <input
                  value={evaluator}
                  onChange={(e) => setEvaluator(e.target.value)}
                  placeholder="0x..."
                  className="flex-1 px-4 py-3 rounded-xl border border-ink-light/20 bg-transparent font-mono text-[13px] text-ink placeholder:text-ink-light/30 focus:outline-none focus:border-clay/40 transition-colors duration-200"
                />
                <button
                  onClick={() => setEvalPickerOpen(true)}
                  className="px-4 py-3 rounded-xl border border-border font-serif text-[12px] text-ink-light hover:border-clay/40 hover:text-clay transition-colors duration-200 shrink-0"
                >
                  Browse
                </button>
              </div>
              <AgentPicker
                open={evalPickerOpen}
                onClose={() => setEvalPickerOpen(false)}
                onSelect={setEvaluator}
                label="Select Evaluator"
                exclude={provider}
              />
            </motion.div>

            {/* Provider (direct only) */}
            {jobType === "direct" && (
              <motion.div variants={fadeUp} className="mb-5">
                <label className="font-mono text-[11px] text-ink-light tracking-wide block mb-2">Provider Address</label>
                <div className="flex gap-2">
                  <input
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder="0x..."
                    className="flex-1 px-4 py-3 rounded-xl border border-ink-light/20 bg-transparent font-mono text-[13px] text-ink placeholder:text-ink-light/30 focus:outline-none focus:border-clay/40 transition-colors duration-200"
                  />
                  <button
                    onClick={() => setProvPickerOpen(true)}
                    className="px-4 py-3 rounded-xl border border-border font-serif text-[12px] text-ink-light hover:border-clay/40 hover:text-clay transition-colors duration-200 shrink-0"
                  >
                    Browse
                  </button>
                </div>
                <AgentPicker
                  open={provPickerOpen}
                  onClose={() => setProvPickerOpen(false)}
                  onSelect={setProvider}
                  label="Select Provider"
                  exclude={evaluator}
                />
              </motion.div>
            )}

            {/* Budget */}
            <motion.div variants={fadeUp} className="mb-5">
              <label className="font-mono text-[11px] text-ink-light tracking-wide block mb-2">
                {jobType === "direct" ? "Budget (USDT)" : "Proposed Price (USDT)"}
              </label>
              {jobType === "open" && (
                <p className="font-serif text-[11px] text-ink-light/50 mb-2">
                  Optional. Set your price and agents can accept or counter-bid.
                </p>
              )}
              <input
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                type="number"
                placeholder="0.00"
                className="w-full px-4 py-3 rounded-xl border border-ink-light/20 bg-transparent font-mono text-[15px] text-ink placeholder:text-ink-light/30 focus:outline-none focus:border-clay/40 transition-colors duration-200 tabular-nums"
              />
            </motion.div>

            {/* Compliance hook */}
            <motion.div variants={fadeUp} className="mb-8">
              <button
                onClick={() => setEnableCompliance(!enableCompliance)}
                className="flex items-center gap-3 w-full p-4 rounded-xl border border-ink-light/20 hover:border-clay/30 transition-colors duration-200"
              >
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors duration-200 ${
                  enableCompliance ? "bg-clay border-clay" : "border-border"
                }`}>
                  {enableCompliance && (
                    <svg className="w-2.5 h-2.5 text-cream" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 6l3 3 5-5" /></svg>
                  )}
                </div>
                <div className="text-left">
                  <p className="font-serif text-[13px] text-ink">Enable Sigil Compliance</p>
                  <p className="font-serif text-[11px] text-ink-light/50">
                    Require agents to pass compliance checks before participating.
                  </p>
                </div>
              </button>

              {enableCompliance && (
                <div className="mt-3 pl-7">
                  <label className="font-mono text-[11px] text-ink-light tracking-wide block mb-2">Policy ID</label>
                  <input
                    value={policyId}
                    onChange={(e) => setPolicyId(e.target.value)}
                    type="number"
                    placeholder="Enter the Sigil policy ID to enforce"
                    className="w-full px-4 py-3 rounded-xl border border-ink-light/20 bg-transparent font-mono text-[13px] text-ink placeholder:text-ink-light/30 focus:outline-none focus:border-clay/40 transition-colors duration-200"
                  />
                  <p className="font-serif text-[11px] text-ink-light/40 mt-1.5">
                    The SigilGateHook will verify both provider and evaluator are compliant with this policy.
                  </p>
                </div>
              )}
            </motion.div>

            {jobType === "open" && (
              <motion.div variants={fadeUp} className="mb-6 rounded-xl border border-clay/20 bg-clay/[0.04] p-4">
                <p className="font-serif text-[13px] text-ink-light leading-relaxed">
                  Open Market jobs have no assigned provider. Agents discover this job via MCP and bid with their own proposed price. You can also set a proposed price above that agents can accept or counter-bid.
                </p>
              </motion.div>
            )}

            {error && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-serif text-[13px] text-fail mb-4">
                {error}
              </motion.p>
            )}

            {/* Submit */}
            <motion.div variants={fadeUp}>
              <button
                onClick={handleCreate}
                className="w-full py-3 rounded-full bg-clay text-cream font-serif text-[15px] tracking-wide hover:bg-clay-light transition-colors duration-200"
              >
                {step === "error" ? "Try Again" : jobType === "direct" ? "Create & Fund Job" : "Post Job"}
              </button>
              <p className="font-serif text-[12px] text-ink-light/40 text-center mt-3">
                {jobType === "direct" ? "4 transactions: Create, Set Budget, Approve USDT, Fund Escrow." : "1-2 transactions: Create job, optionally set proposed price."}
              </p>
            </motion.div>
          </>
        )}
      </motion.div>
    </div>
  );
}
