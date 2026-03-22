"use client";

import { useEffect, useRef } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { sepolia } from "wagmi/chains";

/**
 * Auto-switches the connected wallet to Sepolia after login.
 * Privy's defaultChain config should do this, but MetaMask
 * sometimes ignores it. This hook forces the switch.
 */
export function useChainSwitch() {
  const { authenticated, ready } = usePrivy();
  const { wallets } = useWallets();
  const switched = useRef(false);

  useEffect(() => {
    if (!ready || !authenticated || switched.current) return;
    if (wallets.length === 0) return;

    const wallet = wallets[0];

    const doSwitch = async () => {
      try {
        const currentChainId = await wallet.getEthereumProvider().then(
          (p) => p.request({ method: "eth_chainId" })
        );

        if (Number(currentChainId) !== sepolia.id) {
          await wallet.switchChain(sepolia.id);
        }
        switched.current = true;
      } catch {
        // User declined or chain not available — that's ok
        switched.current = true;
      }
    };

    doSwitch();
  }, [ready, authenticated, wallets]);
}
