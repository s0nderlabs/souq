import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getAddress } from "../protocol.js";
import { SIGIL_SERVER_URL, getSigilApiKey } from "../config.js";

const Schema = z.object({
  prompt: z
    .string()
    .describe(
      "Natural language description of the compliance policy to create. " +
      "Example: 'Create a policy requiring agents to have on-chain transaction history and valid metadata'"
    ),
});

interface CreatePolicyResult {
  success: boolean;
  message: string;
  policy?: {
    policyId?: string;
    scribeResponse: string;
    sessionId?: string;
  };
  error?: string;
}

export function registerCreatePolicy(server: McpServer): void {
  server.tool(
    "create_policy",
    "Create a Sigil compliance policy via the Scribe AI. Defines rules that agents must pass to participate in hooked jobs.",
    Schema.shape,
    async (params) => {
      const result = await handler(params as z.infer<typeof Schema>);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}

async function handler(params: z.infer<typeof Schema>): Promise<CreatePolicyResult> {
  try {
    const walletAddress = await getAddress();
    const apiKey = getSigilApiKey();

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Dev mode auth (API key + wallet header)
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["x-wallet-address"] = walletAddress;
    }

    const response = await fetch(`${SIGIL_SERVER_URL}/inscribe`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: params.prompt }),
    });

    if (!response.ok && !response.headers.get("content-type")?.includes("text/event-stream")) {
      const error = (await response.text());
      return {
        success: false,
        message: "Failed to start policy creation",
        error,
      };
    }

    // Consume SSE stream
    const reader = response.body?.getReader();
    if (!reader) {
      return { success: false, message: "No response stream", error: "Empty body" };
    }

    const decoder = new TextDecoder();
    let fullText = "";
    let sessionId: string | undefined;
    let doneResult: string | undefined;

    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          const eventType = line.slice(7).trim();
          // Next data line will contain the payload — handled below
          continue;
        }
        if (line.startsWith("data: ")) {
          const dataStr = line.slice(6);
          try {
            const data = JSON.parse(dataStr) as Record<string, unknown>;
            if (data.sessionId) sessionId = data.sessionId as string;
            if (data.text) fullText += data.text as string;
            if (data.result) doneResult = data.result as string;
          } catch {
            // Non-JSON data line, skip
          }
        }
      }
    }

    // Extract policyId from the done result if present
    let policyId: string | undefined;
    if (doneResult) {
      const match = doneResult.match(/0x[a-fA-F0-9]{64}/);
      if (match) policyId = match[0];
    }

    return {
      success: true,
      message: policyId
        ? `Policy created: ${policyId}`
        : "Policy creation completed. Check Sigil dashboard for details.",
      policy: {
        policyId,
        scribeResponse: doneResult || fullText,
        sessionId,
      },
    };
  } catch (error) {
    return {
      success: false,
      message: "Failed to create policy",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
