import { API_URL } from "./contracts";

export const relay = {
  jobs: (limit = 20) =>
    fetch(`${API_URL}/relay/jobs?limit=${limit}`).then((r) => r.json()) as Promise<{
      jobs: Array<{
        jobId: number;
        title: string | null;
        description: string | null;
        descriptionCid: string | null;
        client: string | null;
        provider: string | null;
        evaluator: string | null;
        budget: string | null;
        status: string;
        createdAt: number;
      }>;
    }>,

  job: (id: number) =>
    fetch(`${API_URL}/relay/jobs/${id}`).then((r) => r.json()) as Promise<{
      jobId: number;
      title: string | null;
      description: string | null;
      descriptionCid: string | null;
      timeline: Array<{ type: string; data: Record<string, unknown>; timestamp: number }>;
    }>,

  bids: (jobId: number) =>
    fetch(`${API_URL}/relay/bids?jobId=${jobId}`).then((r) => r.json()) as Promise<{
      bids: Array<{
        type: string;
        jobId: number;
        from: string;
        bidder: string;
        proposedBudget: string;
        pitch: string;
        timestamp: number;
      }>;
    }>,

  agents: (limit = 50) =>
    fetch(`${API_URL}/relay/agents?limit=${limit}`).then((r) => r.json()) as Promise<{
      agents: Array<{
        address: string;
        encryptionPublicKey: string | null;
        agentId: string | null;
        name: string | null;
        capabilities: string | null;
        lastSeen: number;
      }>;
    }>,

  ipfs: (cid: string) =>
    fetch(`${API_URL}/ipfs/${cid}`).then((r) => r.json()),

  faucet: (address: string) =>
    fetch(`${API_URL}/faucet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }).then((r) => r.json()) as Promise<{
      success?: boolean;
      amount?: string;
      txHash?: string;
      ethTxHash?: string;
      ethAmount?: string;
      error?: string;
    }>,
};
