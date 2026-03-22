"use client";

import { useEffect, useRef } from "react";
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
  const derivingRef = useRef(false);

  const walletAddress = address || user?.wallet?.address;

  // Connect WebSocket + derive encryption keypair + broadcast pubkey
  useEffect(() => {
    if (!ready || !authenticated || !walletAddress) return;

    // Connect WebSocket
    if (!connectedRef.current) {
      connectRelay(walletAddress);
      connectedRef.current = true;
    }

    // Derive encryption keypair (needs wallets array to be populated)
    if (wallets.length === 0 || derivingRef.current) return;
    if (getCachedKeypair()) {
      // Already cached — just broadcast
      if (!derivingRef.current) {
        derivingRef.current = true;
        setTimeout(async () => {
          const kp = getCachedKeypair();
          if (kp) {
            await sendRelayEventAsync({
              type: "agent:ready",
              data: { address: walletAddress, encryptionPublicKey: kp.publicKeyHex },
            });
          }
        }, 1500);
      }
      return;
    }

    // Derive from signature
    derivingRef.current = true;
    const timer = setTimeout(async () => {
      try {
        // Find the Ethereum wallet matching the connected address
        const wallet = wallets.find(
          (w) => w.walletClientType !== "solana" && w.address?.toLowerCase() === walletAddress?.toLowerCase()
        ) || wallets.find((w) => w.walletClientType !== "solana");
        if (!wallet) throw new Error("No Ethereum wallet found");

        const kp = await deriveEncryptionKeypair(async (message: string) => {
          const sig = await wallet.sign(message);
          return sig;
        });
        await sendRelayEventAsync({
          type: "agent:ready",
          data: { address: walletAddress, encryptionPublicKey: kp.publicKeyHex },
        });
        console.log("[souq] Encryption pubkey broadcast to relay");
      } catch (e) {
        console.warn("[souq] Encryption keypair derivation skipped:", e);
        derivingRef.current = false; // allow retry on next render
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [ready, authenticated, walletAddress, wallets]);

  // Cleanup on logout
  useEffect(() => {
    if (ready && !authenticated && connectedRef.current) {
      disconnectRelay();
      clearKeypair();
      connectedRef.current = false;
      derivingRef.current = false;
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
