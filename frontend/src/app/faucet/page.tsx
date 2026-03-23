"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useChainId } from "wagmi";
import { sepolia } from "wagmi/chains";
import { parseUnits } from "viem";
import { relay } from "@/lib/relay";
import { USDT_ADDRESS, usdtAbi } from "@/lib/contracts";
import { PageHeader } from "@/components/page-header";

const fadeUp = {
  hidden: { opacity: 0, y: 12, filter: "blur(4px)" },
  visible: { opacity: 1, y: 0, filter: "blur(0px)" },
};

const stagger = {
  visible: { transition: { staggerChildren: 0.08 } },
};

export default function FaucetPage() {
  const { authenticated, login, ready, user } = usePrivy();
  const { address: wagmiAddress } = useAccount();
  const { wallets } = useWallets();
  const chainId = useChainId();

  // Privy wallet address first — always correct for current session
  const address = user?.wallet?.address || wagmiAddress;
  const isWrongChain = chainId !== sepolia.id;

  const handleSwitchChain = async () => {
    const wallet = wallets.find((w) => w.address === address) || wallets[0];
    if (wallet) {
      try {
        await wallet.switchChain(sepolia.id);
      } catch {
        // MetaMask will show the switch prompt
      }
    }
  };

  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetResult, setFaucetResult] = useState<{
    success?: boolean;
    ethAmount?: string;
    amount?: string;
    txHash?: string;
    ethTxHash?: string;
    error?: string;
    message?: string;
  } | null>(null);

  const {
    writeContract,
    data: mintTxHash,
    isPending: mintPending,
    error: mintError,
  } = useWriteContract();

  const { isSuccess: mintConfirmed, isLoading: mintConfirming } = useWaitForTransactionReceipt({
    hash: mintTxHash,
  });

  const handleFaucet = async () => {
    if (!address) return;
    setFaucetLoading(true);
    setFaucetResult(null);
    try {
      const result = await relay.faucet(address);
      setFaucetResult(result);
    } catch (e) {
      setFaucetResult({ error: `Faucet request failed: ${e instanceof Error ? e.message : "Unknown error"}` });
    }
    setFaucetLoading(false);
  };

  const handleMint = () => {
    if (!address) return;
    writeContract({
      address: USDT_ADDRESS,
      abi: usdtAbi,
      functionName: "mint",
      args: [address as `0x${string}`, parseUnits("100", 6)],
    });
  };

  if (ready && !authenticated) {
    return (
      <div className="max-w-xl mx-auto px-6 pt-8 pb-16">
        <PageHeader title="Faucet" subtitle="Get test tokens for the Souq testnet." />
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
          <p className="font-serif text-ink-light mb-4">Connect your wallet to get test tokens.</p>
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

  if (!ready) {
    return (
      <div className="max-w-xl mx-auto px-6 pt-8 pb-16">
        <PageHeader title="Faucet" subtitle="Get test tokens for the Souq testnet." />
        <div className="flex justify-center py-16">
          <div className="w-6 h-6 border-2 border-clay/30 border-t-clay rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-6 pt-8 pb-16">
      <PageHeader title="Faucet" subtitle="Get test tokens for the Souq testnet." />

      {/* Wrong chain warning */}
      {isWrongChain && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 p-4 rounded-xl border border-fail/30 bg-fail/[0.06]"
        >
          <p className="font-serif text-[13px] text-fail mb-3">
            Your wallet is not on the Sepolia testnet. Switch networks to use the faucet.
          </p>
          <button
            onClick={handleSwitchChain}
            className="px-5 py-2 rounded-full bg-fail text-cream font-serif text-[13px] hover:bg-fail/90 transition-colors duration-200"
          >
            Switch to Sepolia
          </button>
        </motion.div>
      )}

      <motion.div initial="hidden" animate="visible" variants={stagger} className="space-y-4">
        {/* Step 1: ETH + USDT from faucet */}
        <motion.div variants={fadeUp} className="rounded-2xl border border-border p-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-clay/10 font-mono text-[11px] text-clay">1</span>
            <p className="font-display italic text-[17px] text-ink">Request Test Tokens</p>
          </div>
          <p className="font-serif text-[13px] text-ink-light mb-4 leading-relaxed">
            Get Sepolia ETH for gas and USDT for escrow payments from the relay faucet. No wallet signature needed.
          </p>

          <button
            onClick={handleFaucet}
            className="w-full py-2.5 rounded-full bg-clay text-cream font-serif text-[14px] tracking-wide hover:bg-clay-light transition-colors duration-200"
          >
            {faucetLoading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-cream/30 border-t-cream rounded-full animate-spin" />
                Requesting...
              </span>
            ) : "Get Test Tokens"}
          </button>

          {faucetResult && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className={`mt-3 p-3 rounded-xl ${faucetResult.error || !faucetResult.success ? "bg-fail/10" : "bg-emerald-50"}`}
            >
              {faucetResult.error || !faucetResult.success ? (
                <p className="font-serif text-[13px] text-fail">
                  {faucetResult.error || faucetResult.message || "Faucet request failed."}
                </p>
              ) : (
                <div className="space-y-1">
                  {faucetResult.ethAmount && (
                    <p className="font-mono text-[12px] text-emerald-700">
                      + {faucetResult.ethAmount} ETH received
                    </p>
                  )}
                  {faucetResult.amount && (
                    <p className="font-mono text-[12px] text-emerald-700">
                      + {faucetResult.amount} USDT received
                    </p>
                  )}
                  {!faucetResult.ethAmount && !faucetResult.amount && (
                    <p className="font-mono text-[12px] text-emerald-700">
                      Tokens sent successfully.
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </motion.div>

        {/* Step 2: Mint USDT */}
        <motion.div variants={fadeUp} className="rounded-2xl border border-border p-6">
          <div className="flex items-center gap-3 mb-3">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-clay/10 font-mono text-[11px] text-clay">2</span>
            <p className="font-display italic text-[17px] text-ink">Mint More USDT</p>
          </div>
          <p className="font-serif text-[13px] text-ink-light mb-4 leading-relaxed">
            Mint 100 USDT directly from the test contract. This requires a wallet transaction.
          </p>

          <button
            onClick={handleMint}
            className="w-full py-2.5 rounded-full border border-clay text-clay font-serif text-[14px] tracking-wide hover:bg-clay/[0.04] transition-colors duration-200"
          >
            {mintPending ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-clay/30 border-t-clay rounded-full animate-spin" />
                Waiting for wallet...
              </span>
            ) : mintConfirming ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-clay/30 border-t-clay rounded-full animate-spin" />
                Confirming...
              </span>
            ) : mintConfirmed ? "Mint Again" : "Mint 100 USDT"}
          </button>

          {mintConfirmed && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-mono text-[12px] text-emerald-700 mt-3 text-center"
            >
              100 USDT minted successfully.
            </motion.p>
          )}

          {mintError && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-serif text-[13px] text-fail mt-3"
            >
              {mintError.message.includes("User rejected")
                ? "Transaction rejected."
                : "Mint failed. Make sure you have Sepolia ETH for gas."}
            </motion.p>
          )}
        </motion.div>

        {/* Info */}
        <motion.div variants={fadeUp} className="rounded-xl border border-clay/20 bg-clay/[0.04] p-4">
          <p className="font-serif text-[12px] text-ink-light leading-relaxed">
            These are testnet tokens with no real value. Sepolia ETH is used for gas fees.
            USDT is the payment token used in Souq escrow contracts.
            If you connected with an embedded wallet (email/social login), transactions are signed automatically without MetaMask.
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}
