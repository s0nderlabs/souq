"use client";

import { useEffect, useRef, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { connectRelay, disconnectRelay, onRelayEvent, sendRelayEventAsync } from "@/lib/websocket";
import type { RelayEvent } from "@/lib/websocket";
import { deriveEncryptionKeypair, getCachedKeypair, clearKeypair } from "@/lib/encryption";

export function useRelay() {
  const { authenticated, ready, user } = usePrivy();
  const { wallets } = useWallets();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const connectedRef = useRef(false);
  const derivedRef = useRef(false);

  const walletAddress = address || user?.wallet?.address;

  // Connect WebSocket
  useEffect(() => {
    if (!ready || !authenticated || !walletAddress) return;
    if (!connectedRef.current) {
      connectRelay(walletAddress);
      connectedRef.current = true;
    }
  }, [ready, authenticated, walletAddress]);

  // Derive encryption keypair — separate effect so wallets changes don't cancel the timer
  const deriveKeypair = useCallback(async () => {
    if (derivedRef.current || !user?.wallet?.address) return;
    const addr = user.wallet.address;
    if (getCachedKeypair(addr)) {
      derivedRef.current = true;
      await sendRelayEventAsync({
        type: "agent:ready",
        data: { address: addr, encryptionPublicKey: getCachedKeypair(addr)!.publicKeyHex },
      });
      return;
    }

    // Find the right wallet
    const privyAddr = user.wallet.address.toLowerCase();
    const wallet = wallets.find(
      (w) => w.walletClientType !== "solana" && w.address?.toLowerCase() === privyAddr
    ) || wallets.find((w) => w.walletClientType === "privy")
      || wallets.find((w) => w.walletClientType !== "solana");

    if (!wallet) return; // wallets not ready yet, will retry on next render

    derivedRef.current = true;
    try {
      const kp = await deriveEncryptionKeypair(async (message: string) => {
        const provider = await wallet.getEthereumProvider();
        const sig = await provider.request({
          method: "personal_sign",
          params: [message, wallet.address],
        });
        return sig as string;
      }, user.wallet.address);
      await sendRelayEventAsync({
        type: "agent:ready",
        data: { address: user.wallet.address, encryptionPublicKey: kp.publicKeyHex },
      });
      console.log("[souq] Encryption pubkey broadcast to relay");
    } catch (e) {
      console.warn("[souq] Encryption keypair derivation skipped:", e);
      derivedRef.current = false; // allow retry
    }
  }, [wallets, user?.wallet?.address]);

  useEffect(() => {
    if (!ready || !authenticated || !walletAddress || derivedRef.current) return;
    if (wallets.length === 0) return;

    // Small delay to let Privy embedded wallet fully initialize
    const timer = setTimeout(deriveKeypair, 2000);
    return () => clearTimeout(timer);
  }, [ready, authenticated, walletAddress, wallets, deriveKeypair]);

  // Cleanup on logout
  useEffect(() => {
    if (ready && !authenticated && connectedRef.current) {
      disconnectRelay();
      clearKeypair(walletAddress);
      connectedRef.current = false;
      derivedRef.current = false;
    }
  }, [ready, authenticated]);

  // Listen for relay events and invalidate queries
  useEffect(() => {
    const unsub = onRelayEvent((event: RelayEvent) => {
      switch (event.type) {
        case "job:created":
        case "job:funded":
        case "job:submitted":
        case "job:completed":
        case "job:rejected":
        case "job:provider_set":
        case "job:budget_set":
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
          if (event.jobId) {
            queryClient.invalidateQueries({ queryKey: ["job", event.jobId] });
          }
          break;
        case "job:bid":
          if (event.jobId) {
            queryClient.invalidateQueries({ queryKey: ["bids", event.jobId] });
            queryClient.invalidateQueries({ queryKey: ["job", event.jobId] });
          }
          queryClient.invalidateQueries({ queryKey: ["jobs"] });
          break;
        case "agent:ready":
          queryClient.invalidateQueries({ queryKey: ["agents"] });
          break;
      }
    });
    return unsub;
  }, [queryClient]);
}
