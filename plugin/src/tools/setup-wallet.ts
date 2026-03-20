// Setup Wallet — Initialize WDK smart account, return address + balances + encryption pubkey
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatUnits, type Address } from "viem";
import { initWdk, getAddress, getPublicClient } from "../protocol.js";
import { USDT_ADDRESS, USDT_DECIMALS, explorerAddressUrl, getSeedPhrase, getSouqApiUrl } from "../config.js";
import { usdtAbi } from "../abi/usdt.js";
import { deriveKeypairFromSeed } from "../encryption.js";
import { bytesToHex } from "viem";

const SetupWalletSchema = z.object({});

interface SetupWalletResult {
  success: boolean;
  message: string;
  wallet?: {
    address: string;
    explorerUrl: string;
    usdtBalance: string;
    ethBalance: string;
    encryptionPublicKey: string;
  };
  faucet?: {
    status: string;
    amount?: string;
  };
  error?: string;
}

export function registerSetupWallet(server: McpServer): void {
  server.tool(
    "setup_wallet",
    "Initialize WDK wallet and return address, balances, and encryption public key",
    SetupWalletSchema.shape,
    async (params): Promise<{ content: Array<{ type: "text"; text: string }> }> => {
      const result = await setupWalletHandler(params as z.infer<typeof SetupWalletSchema>);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );
}

async function setupWalletHandler(
  params: z.infer<typeof SetupWalletSchema>
): Promise<SetupWalletResult> {
  try {
    // Initialize WDK (idempotent)
    await initWdk();

    // Get smart account address
    const address = await getAddress();
    const publicClient = getPublicClient();

    // Request faucet tokens from backend
    let faucetResult: { status: string; amount?: string } = { status: "skipped" };
    try {
      const apiUrl = getSouqApiUrl();
      const faucetResponse = await fetch(`${apiUrl}/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });

      if (faucetResponse.ok) {
        const faucetData = (await faucetResponse.json()) as { amount?: string };
        faucetResult = { status: "funded", amount: faucetData.amount || "5 USDT" };
        console.error(`[souq] Faucet: received ${faucetResult.amount}`);
      } else if (faucetResponse.status === 409) {
        faucetResult = { status: "already_claimed" };
        console.error("[souq] Faucet: already claimed");
      } else {
        faucetResult = { status: `error (${faucetResponse.status})` };
        console.error(`[souq] Faucet error: ${faucetResponse.status}`);
      }
    } catch (faucetError) {
      faucetResult = { status: "unavailable" };
      console.error(`[souq] Faucet unavailable: ${faucetError instanceof Error ? faucetError.message : String(faucetError)}`);
    }

    // Read balances in parallel
    const [usdtBalanceRaw, ethBalanceRaw] = await Promise.all([
      publicClient.readContract({
        address: USDT_ADDRESS,
        abi: usdtAbi,
        functionName: "balanceOf",
        args: [address],
      }) as Promise<bigint>,
      publicClient.getBalance({ address }),
    ]);
    const usdtBalance = formatUnits(usdtBalanceRaw, USDT_DECIMALS);
    const ethBalance = formatUnits(ethBalanceRaw, 18);

    // Derive encryption keypair
    const seedPhrase = getSeedPhrase();
    const keypair = deriveKeypairFromSeed(seedPhrase);
    const encryptionPublicKey = bytesToHex(keypair.publicKey);

    return {
      success: true,
      message: `Wallet initialized: ${address}`,
      wallet: {
        address,
        explorerUrl: explorerAddressUrl(address),
        usdtBalance: `${usdtBalance} USDT`,
        ethBalance: `${ethBalance} ETH`,
        encryptionPublicKey,
      },
      faucet: faucetResult,
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to initialize wallet",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
