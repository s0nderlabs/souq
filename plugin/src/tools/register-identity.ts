import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { encodeFunctionData } from "viem";
import { bytesToHex } from "viem";
import { getAddress, sendTx, getPublicClient, waitForUserOp } from "../protocol.js";
import { IDENTITY_REGISTRY, explorerTxUrl, getSeedPhrase } from "../config.js";
import { identityAbi } from "../abi/identity.js";
import { pinJson, toIpfsUri } from "../ipfs.js";
import { deriveKeypairFromSeed } from "../encryption.js";

const Schema = z.object({
  name: z.string().describe("Agent display name"),
  description: z.string().describe("Agent description"),
  capabilities: z.string().describe("Comma-separated list of capabilities (e.g. 'research,writing,analysis')"),
});

interface RegisterIdentityResult {
  success: boolean;
  message: string;
  transaction?: {
    hash: string;
    explorerUrl: string;
  };
  identity?: {
    agentId: string;
    name: string;
    wallet: string;
    encryptionPublicKey: string;
    ipfsCid?: string;
    ipfsUri?: string;
  };
  error?: string;
}

export function registerRegisterIdentity(server: McpServer): void {
  server.tool(
    "register_identity",
    "Register an ERC-8004 agent identity. Uploads agent-card to IPFS. Returns existing identity if already registered.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<RegisterIdentityResult> {
  try {
    const address = await getAddress();
    const publicClient = getPublicClient();

    // Derive encryption keypair from seed
    const seed = getSeedPhrase();
    const keypair = deriveKeypairFromSeed(seed);
    const encryptionPublicKey = bytesToHex(keypair.publicKey);

    // Check if already registered (one identity per wallet)
    const balance = await publicClient.readContract({
      address: IDENTITY_REGISTRY,
      abi: identityAbi,
      functionName: "balanceOf",
      args: [address],
    }) as bigint;

    if (balance > 0n) {
      const agentId = await publicClient.readContract({
        address: IDENTITY_REGISTRY,
        abi: identityAbi,
        functionName: "tokenOfOwnerByIndex",
        args: [address, 0n],
      }) as bigint;

      return {
        success: true,
        message: `Identity already registered: agentId=${agentId}`,
        identity: {
          agentId: agentId.toString(),
          name: params.name,
          wallet: address,
          encryptionPublicKey,
        },
      };
    }

    // Parse capabilities
    const capabilities = params.capabilities
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    // Build agent-card JSON
    const agentCard = {
      name: params.name,
      description: params.description,
      capabilities,
      wallet: address,
      encryptionPublicKey,
      createdAt: new Date().toISOString(),
    };

    // Pin agent-card to IPFS
    const { cid } = await pinJson(agentCard);
    const agentURI = toIpfsUri(cid);

    // Encode register call
    const data = encodeFunctionData({
      abi: identityAbi,
      functionName: "register",
      args: [agentURI],
    });

    const { hash } = await sendTx(IDENTITY_REGISTRY, data);
    const { receipt } = await waitForUserOp(hash);

    // Parse agentId from Transfer event (ERC-721 mint)
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

    return {
      success: true,
      message: `Agent identity registered: ${params.name} (ID: ${agentId})`,
      transaction: {
        hash,
        explorerUrl: explorerTxUrl(hash),
      },
      identity: {
        agentId,
        name: params.name,
        wallet: address,
        encryptionPublicKey,
        ipfsCid: cid,
        ipfsUri: agentURI,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to register identity",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
