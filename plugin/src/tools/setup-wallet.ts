// Setup Wallet — Initialize WDK smart account, auto-register ERC-8004 identity
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData, formatUnits, bytesToHex, type Address, type Hex } from "viem";
import { initWdk, getAddress, getPublicClient, sendTx, waitForUserOp } from "../protocol.js";
import { warmupX402Client } from "../x402-client.js";
import { USDT_ADDRESS, USDT_DECIMALS, IDENTITY_REGISTRY, explorerAddressUrl, getSeedPhrase, getSouqApiUrl, getCachedAgentId, cacheAgentId } from "../config.js";
import { usdtAbi } from "../abi/usdt.js";
import { identityAbi } from "../abi/identity.js";
import { deriveKeypairFromSeed } from "../encryption.js";
import { pinJson, toIpfsUri } from "../ipfs.js";
import { sendRelayEvent } from "../relay.js";

const SetupWalletSchema = z.object({
  name: z.string().default("Souq Agent").describe("Agent display name"),
  description: z.string().default("AI agent on Souq Protocol").describe("Agent description"),
  capabilities: z.string().default("commerce").describe("Comma-separated capabilities, e.g. 'research,analysis,writing'"),
});

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
  identity?: {
    agentId: string;
    status: "registered" | "already_registered";
    name?: string;
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
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
    const address = await getAddress();
    const publicClient = getPublicClient();

    // Pre-warm x402 signer
    await warmupX402Client();

    // Request faucet tokens
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
        faucetResult = { status: "funded", amount: faucetData.amount || "100 USDT" };
        console.error(`[souq] Faucet: received ${faucetResult.amount}`);
      } else if (faucetResponse.status === 409) {
        faucetResult = { status: "already_claimed" };
        console.error("[souq] Faucet: already claimed");
      } else {
        faucetResult = { status: `error (${faucetResponse.status})` };
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

    // Auto-register ERC-8004 identity if not already registered
    let identityResult: SetupWalletResult["identity"];
    try {
      // Check local cache first (fastest, no RPC)
      const cachedId = getCachedAgentId(address);
      if (cachedId) {
        identityResult = { agentId: cachedId, status: "already_registered" };
        console.error(`[souq] Identity from cache: agentId=${cachedId}`);
      } else {
      // Check on-chain
      const identityBalance = await publicClient.readContract({
        address: IDENTITY_REGISTRY,
        abi: identityAbi,
        functionName: "balanceOf",
        args: [address],
      }) as bigint;

      if (identityBalance > 0n) {
        // Registered on-chain but not cached — scan Transfer events to recover agentId
        let resolvedAgentId = "unknown";
        try {
          const logs = await publicClient.getLogs({
            address: IDENTITY_REGISTRY,
            event: {
              type: "event",
              name: "Transfer",
              inputs: [
                { name: "from", type: "address", indexed: true },
                { name: "to", type: "address", indexed: true },
                { name: "tokenId", type: "uint256", indexed: true },
              ],
            },
            args: { from: "0x0000000000000000000000000000000000000000" as `0x${string}`, to: address },
            fromBlock: "earliest",
          });
          if (logs.length > 0 && logs[0].args.tokenId != null) {
            resolvedAgentId = logs[0].args.tokenId.toString();
            cacheAgentId(resolvedAgentId, address);
            console.error(`[souq] AgentId recovered from Transfer events: ${resolvedAgentId}`);
          }
        } catch (logErr) {
          console.error(`[souq] Transfer log scan failed (non-fatal): ${logErr instanceof Error ? logErr.message : logErr}`);
        }
        identityResult = { agentId: resolvedAgentId, status: "already_registered" };
        console.error(`[souq] Identity registered on-chain (agentId: ${resolvedAgentId})`);
      } else {
        // Register new identity
        const capabilities = params.capabilities.split(",").map(s => s.trim()).filter(Boolean);
        const agentCard = {
          name: params.name,
          description: params.description,
          capabilities,
          wallet: address,
          encryptionPublicKey,
          createdAt: new Date().toISOString(),
        };

        const { cid } = await pinJson(agentCard);
        const agentURI = toIpfsUri(cid);
        console.error(`[souq] Agent card pinned: ${cid}`);

        const data = encodeFunctionData({
          abi: identityAbi,
          functionName: "register",
          args: [agentURI],
        });

        const txResult = await sendTx(IDENTITY_REGISTRY, data);
        const { receipt } = await waitForUserOp(txResult.hash);

        // Parse agentId from Transfer event
        let agentId = "unknown";
        const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
        for (const log of receipt.logs) {
          if (
            log.address.toLowerCase() === IDENTITY_REGISTRY.toLowerCase() &&
            log.topics[0] === TRANSFER_TOPIC &&
            log.topics.length >= 4
          ) {
            agentId = BigInt(log.topics[3] as string).toString();
            break;
          }
        }

        // Cache agentId locally for future startups
        if (agentId !== "unknown") cacheAgentId(agentId, address);
        identityResult = { agentId, status: "registered", name: params.name };
        console.error(`[souq] Identity registered: agentId=${agentId}`);
      }
      } // end cache else
    } catch (identityError) {
      // Non-fatal — wallet works without identity, just can't use hooks
      console.error(`[souq] Identity registration skipped: ${identityError instanceof Error ? identityError.message : String(identityError)}`);
    }

    // Broadcast agent:ready with pubkey so other agents can discover it
    sendRelayEvent({ type: "agent:ready", data: { address, encryptionPublicKey, agentId: identityResult?.agentId, name: params.name, capabilities: params.capabilities } });

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
      identity: identityResult,
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
