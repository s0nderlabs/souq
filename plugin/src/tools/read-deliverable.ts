// Read Deliverable — Client or Evaluator decrypts the deliverable
// Client: decrypts re-encrypted package after job completion
// Evaluator: decrypts provider's submission to review before approving/rejecting
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
      "IPFS CID of the re-encrypted deliverable for the client. Auto-detected from job:completed notification if omitted. Only used when client reads."
    ),
});

interface ReadDeliverableResult {
  success: boolean;
  message: string;
  deliverable?: string;
  deliverableCid?: string;
  role?: string;
  error?: string;
}

export function registerReadDeliverable(server: McpServer): void {
  server.tool(
    "read_deliverable",
    "Decrypt and read a job's deliverable. Client reads after completion, evaluator reads submitted work to review before approving.",
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

    const isClient = callerAddress.toLowerCase() === job.client.toLowerCase();
    const isEvaluator = callerAddress.toLowerCase() === job.evaluator.toLowerCase();

    if (!isClient && !isEvaluator) {
      return {
        success: false,
        message: "Only the client or evaluator can read the deliverable",
        error: `Caller ${callerAddress} is neither the client ${job.client} nor the evaluator ${job.evaluator}`,
      };
    }

    // ── Evaluator path: decrypt provider's submission ──
    if (isEvaluator) {
      // Evaluator can read submitted or completed jobs
      if (job.status !== 2 && job.status !== 3) {
        return {
          success: false,
          message: `Job is not Submitted or Completed. Current status: ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`,
          error: "Deliverable is only available after work is submitted",
        };
      }

      // Find the deliverableCid from job:submitted event
      let cid: string | undefined;
      const events = await getBufferedEventsAsync();
      const submitEvent = events
        .filter((e) => e.type === "job:submitted" && e.jobId === params.jobId)
        .pop();
      cid = (submitEvent?.data as Record<string, string>)?.deliverableCid;

      // Fallback to relay API
      if (!cid) {
        try {
          const res = await originalFetch(`${getSouqApiUrl()}/relay/jobs/${params.jobId}`);
          if (res.ok) {
            const relayJob = (await res.json()) as { timeline?: Array<{ type: string; data?: Record<string, string> }> };
            const relaySubmit = relayJob.timeline?.filter((e) => e.type === "job:submitted").pop();
            cid = relaySubmit?.data?.deliverableCid;
          }
        } catch { /* relay lookup non-fatal */ }
      }

      if (!cid) {
        return {
          success: false,
          message: "Deliverable CID not found. The job:submitted event may be missing from the relay.",
        };
      }

      console.error(`[souq] Evaluator reading deliverableCid: ${cid}`);

      // Fetch and decrypt — the deliverable was encrypted for the evaluator
      const encryptedData = await fetchFromIpfs(cid);
      const encryptedPayload = JSON.parse(encryptedData.toString("utf-8")) as { package: EncryptedPackage };
      const seedPhrase = getSeedPhrase();
      const keypair = deriveKeypairFromSeed(seedPhrase);
      const decryptedContent = decrypt(encryptedPayload.package, keypair.privateKey);

      return {
        success: true,
        message: `Deliverable for Job #${params.jobId} decrypted successfully (evaluator review)`,
        deliverable: decryptedContent.toString("utf-8"),
        deliverableCid: cid,
        role: "evaluator",
      };
    }

    // ── Client path: decrypt re-encrypted package ──
    // Client can only read completed jobs
    if (job.status !== 3) {
      return {
        success: false,
        message: `Job is not Completed. Current status: ${JOB_STATUS[job.status as keyof typeof JOB_STATUS] ?? job.status}`,
        error: "Deliverable is only available after job completion",
      };
    }

    // Resolve clientDeliverableCid
    let cid = params.clientDeliverableCid;
    if (!cid) {
      const events = await getBufferedEventsAsync();
      const completeEvent = events
        .filter((e) => e.type === "job:completed" && e.jobId === params.jobId)
        .pop();
      cid = (completeEvent?.data as Record<string, string>)?.clientDeliverableCid;

      // Fallback to relay API
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
          message: "Client deliverable CID not found. Either pass clientDeliverableCid or ensure the job:completed event was received.",
        };
      }
      console.error(`[souq] Auto-discovered clientDeliverableCid: ${cid}`);
    }

    // Fetch and decrypt — the deliverable was re-encrypted for the client
    const encryptedData = await fetchFromIpfs(cid);
    const encryptedPayload = JSON.parse(encryptedData.toString("utf-8")) as { package: EncryptedPackage };
    const seedPhrase = getSeedPhrase();
    const keypair = deriveKeypairFromSeed(seedPhrase);
    const decryptedContent = decrypt(encryptedPayload.package, keypair.privateKey);

    return {
      success: true,
      message: `Deliverable for Job #${params.jobId} decrypted successfully`,
      deliverable: decryptedContent.toString("utf-8"),
      deliverableCid: cid,
      role: "client",
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to read deliverable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
