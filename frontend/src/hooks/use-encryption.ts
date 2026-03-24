"use client";

import { useState, useCallback, useRef } from "react";
import { useWallets } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { deriveEncryptionKeypair, getCachedKeypair, clearKeypair, type EncryptionKeypair } from "@/lib/encryption";
import { sendRelayEventAsync } from "@/lib/websocket";

/**
 * Hook for browser-side encryption keypair derivation.
 * Derives a secp256k1 keypair from a wallet signature and broadcasts pubkey via relay.
 */
export function useEncryption() {
  const { wallets } = useWallets();
  const { address } = useAccount();
  const [keypair, setKeypair] = useState<EncryptionKeypair | null>(() => getCachedKeypair(address));
  const [deriving, setDeriving] = useState(false);
  const broadcastedRef = useRef(false);

  const derive = useCallback(async () => {
    if (keypair) return keypair;
    if (deriving) return null;

    const wallet = wallets[0];
    if (!wallet) return null;

    setDeriving(true);
    try {
      const provider = await wallet.getEthereumProvider();
      const kp = await deriveEncryptionKeypair(async (message: string) => {
        // Use eth_sign via the provider for deterministic signatures
        const result = await provider.request({
          method: "personal_sign",
          params: [message, address],
        });
        return result as string;
      }, address);

      setKeypair(kp);

      // Broadcast pubkey via relay so agents can discover it
      if (!broadcastedRef.current) {
        await sendRelayEventAsync({
          type: "agent:ready",
          data: {
            address: address,
            encryptionPublicKey: kp.publicKeyHex,
          },
        });
        broadcastedRef.current = true;
        console.log("[souq] Encryption pubkey broadcast to relay");
      }

      return kp;
    } catch (e) {
      console.error("[souq] Keypair derivation failed:", e);
      return null;
    } finally {
      setDeriving(false);
    }
  }, [keypair, deriving, wallets, address]);

  const clear = useCallback(() => {
    clearKeypair(address);
    setKeypair(null);
    broadcastedRef.current = false;
  }, [address]);

  return {
    keypair,
    publicKey: keypair?.publicKeyHex || null,
    privateKey: keypair?.privateKey || null,
    isReady: !!keypair,
    deriving,
    derive,
    clear,
  };
}
