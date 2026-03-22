// Read Deliverable — Client decrypts their re-encrypted deliverable after job completion
// Copyright (c) 2026 s0nderlabs

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAddress, getPublicClient } from "../protocol.js";
import { ESCROW_ADDRESS, getSeedPhrase, getSouqApiUrl } from "../config.js";
import { escrowAbi, JOB_STATUS } from "../abi/escrow.js";
import { fetchFromIpfs } from "../ipfs.js";
import { decrypt, deriveKeypairFromSeed, type EncryptedPackage } from "../encryption.js";
import { getBufferedEventsAsync } from "../relay.js";
import { originalFetch } from "../x402-fetch-patch.js";

const Schema = z.object({
  jobId: z.number().describe("The job ID whose deliverable to read."),
  clientDeliverableCid: z
    .string()
    .optional()
    .describe(
      "IPFS CID of the re-encrypted deliverable for the client. Auto-detected from job:completed notification if omitted."
    ),
});

interface ReadDeliverableResult {
  success: boolean;
  message: string;
  deliverable?: string;
  deliverableCid?: string;
  error?: string;
}

export function registerReadDeliverable(server: McpServer): void {
  server.tool(
    "read_deliverable",
    "Decrypt and read a completed job's deliverable. Client only — uses your wallet key to decrypt.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<ReadDeliverableResult> {
  try {
    const callerAddress = await getAddress();
    const publicClient = getPublicClient();

    // Read job from contract
    const job = (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: escrowAbi,
      functionName: "getJob",
      args: [BigInt(params.jobId)],
    })) as {
      client: string;
      provider: string;
      evaluator: string;
      budget: bigint;
      status: number;
    };

    // Validate caller is the client
    if (callerAddress.toLowerCase() !== job.client.toLowerCase()) {
      return {
        success: false,
        message: "Only the client can read the deliverable",
        error: `Caller ${callerAddress} is not the client ${job.client}`,
      };
    }

    // Validate job is completed
    if (job.status !== 3) {
      return {
        success: false,
        message: `Job is not Completed. Current status: ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`,
        error: "Deliverable is only available after job completion",
      };
    }

    // Resolve clientDeliverableCid from param, local buffer, or relay API
    let cid = params.clientDeliverableCid;
    if (!cid) {
      // 1. Check local event buffer
      const events = await getBufferedEventsAsync();
      const completeEvent = events
        .filter((e) => e.type === "job:completed" && e.jobId === params.jobId)
        .pop();
      cid = (completeEvent?.data as Record<string, string>)?.clientDeliverableCid;
      // 2. Fallback to relay API (handles MCP restart / buffer clear)
      if (!cid) {
        try {
          const res = await originalFetch(`${getSouqApiUrl()}/relay/jobs/${params.jobId}`);
          if (res.ok) {
            const relayJob = (await res.json()) as { timeline?: Array<{ type: string; data?: Record<string, string> }> };
            const relayComplete = relayJob.timeline?.filter((e) => e.type === "job:completed").pop();
            cid = relayComplete?.data?.clientDeliverableCid;
          }
        } catch { /* relay lookup non-fatal */ }
      }
      if (!cid) {
        return {
          success: false,
          message:
            "Client deliverable CID not found. Either pass clientDeliverableCid or ensure the job:completed event was received via notifications.",
        };
      }
      console.error(`[souq] Auto-discovered clientDeliverableCid: ${cid}`);
    }

    // Fetch encrypted package from IPFS
    const encryptedData = await fetchFromIpfs(cid);
    const encryptedPayload = JSON.parse(encryptedData.toString("utf-8")) as {
      package: EncryptedPackage;
    };

    // Derive client keypair and decrypt
    const seedPhrase = getSeedPhrase();
    const keypair = deriveKeypairFromSeed(seedPhrase);
    const decryptedContent = decrypt(encryptedPayload.package, keypair.privateKey);

    return {
      success: true,
      message: `Deliverable for Job #${params.jobId} decrypted successfully`,
      deliverable: decryptedContent.toString("utf-8"),
      deliverableCid: cid,
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to read deliverable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
