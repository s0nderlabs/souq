// Setup Wallet — Initialize WDK smart account, return address + balances + encryption pubkey
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatUnits, type Address } from "viem";
import { initWdk, getAddress, getPublicClient } from "../protocol.js";
import { USDT_ADDRESS, USDT_DECIMALS, explorerAddressUrl, getSeedPhrase } from "../config.js";
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

    // Read USDT balance
    const usdtBalanceRaw = await publicClient.readContract({
      address: USDT_ADDRESS,
      abi: usdtAbi,
      functionName: "balanceOf",
      args: [address],
    }) as bigint;
    const usdtBalance = formatUnits(usdtBalanceRaw, USDT_DECIMALS);

    // Read ETH balance
    const ethBalanceRaw = await publicClient.getBalance({ address });
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
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to initialize wallet",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
