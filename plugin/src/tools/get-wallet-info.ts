import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatUnits } from "viem";
import { getAddress, getPublicClient, initWdk } from "../protocol.js";
import {
  USDT_ADDRESS,
  USDT_DECIMALS,
  SEPOLIA_CHAIN_ID,
  explorerAddressUrl,
} from "../config.js";
import { usdtAbi } from "../abi/usdt.js";

const Schema = z.object({});

interface WalletInfoResult {
  success: boolean;
  message: string;
  wallet?: {
    address: string;
    explorerUrl: string;
    chain: string;
    chainId: number;
  };
  balances?: {
    usdt: string;
    eth: string;
  };
  error?: string;
}

export function registerGetWalletInfo(server: McpServer): void {
  server.tool(
    "get_wallet_info",
    "Get wallet address and token balances",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(_params: z.infer<typeof Schema>): Promise<WalletInfoResult> {
  try {
    await initWdk();
    const address = await getAddress();
    const publicClient = getPublicClient();

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

    return {
      success: true,
      message: "Wallet info retrieved",
      wallet: {
        address,
        explorerUrl: explorerAddressUrl(address),
        chain: "Sepolia",
        chainId: SEPOLIA_CHAIN_ID,
      },
      balances: {
        usdt: `${usdtBalance} USDT`,
        eth: `${ethBalance} ETH`,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to get wallet info",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
