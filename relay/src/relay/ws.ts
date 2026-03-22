import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * SouqRelay Durable Object
 *
 * WebSocket relay for real-time communication between Souq agents.
 * Supports directed messages (via `to` field) and broadcast.
 * Connections are tagged by wallet address for routing.
 * Events are persisted in SQLite for missed-event recovery on reconnect.
 */
export class SouqRelay extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Initialize SQLite schema for event persistence
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS events (
          id      INTEGER PRIMARY KEY AUTOINCREMENT,
          wallet  TEXT NOT NULL,
          type    TEXT NOT NULL,
          job_id  INTEGER,
          payload TEXT NOT NULL,
          ts      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wallet_ts ON events(wallet, ts);
        CREATE INDEX IF NOT EXISTS idx_job_id ON events(job_id);
        CREATE INDEX IF NOT EXISTS idx_type_job ON events(type, job_id);
        CREATE INDEX IF NOT EXISTS idx_ts ON events(ts);
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // HTTP endpoint for fetching missed events (with optional jobId filter)
    if (url.pathname === "/relay/events") {
      const wallet = url.searchParams.get("wallet");
      if (!wallet) {
        return Response.json({ error: "wallet param required" }, { status: 400 });
      }
      const since = Number(url.searchParams.get("since") || 0);
      const jobId = Number(url.searchParams.get("jobId") || 0);
      const rows = this.ctx.storage.sql
        .exec(
          "SELECT id, wallet, type, job_id, payload, ts FROM events WHERE wallet = ? AND ts > ? AND (? = 0 OR job_id = ?) ORDER BY ts ASC LIMIT 100",
          wallet.toLowerCase(),
          since,
          jobId,
          jobId
        )
        .toArray();

      const events = rows.map((row: Record<string, unknown>) => ({
        ...(JSON.parse(row.payload as string) as Record<string, unknown>),
        type: row.type,
        jobId: row.job_id,
        timestamp: row.ts,
      }));

      return Response.json(events);
    }

    // HTTP endpoint for listing jobs with descriptions (from stored job:created events)
    if (url.pathname === "/relay/jobs") {
      const limit = Math.max(1, Math.min(Number(url.searchParams.get("limit") || 50), 200));
      const rows = this.ctx.storage.sql
        .exec(
          "SELECT job_id, payload, MAX(ts) as ts FROM events WHERE type = 'job:created' AND job_id > 0 GROUP BY job_id ORDER BY ts DESC LIMIT ?",
          limit
        )
        .toArray();

      // Batch-fetch latest status for all jobs in one query (avoids N+1)
      const jobIds = rows.map((r: Record<string, unknown>) => r.job_id as number);
      const statusMap = new Map<number, string>();
      if (jobIds.length > 0) {
        const statusRows = this.ctx.storage.sql
          .exec(
            `SELECT job_id, type FROM events
             WHERE job_id IN (${jobIds.map(() => "?").join(",")})
             AND type IN ('job:completed','job:rejected','job:funded','job:submitted')
             ORDER BY ts DESC`,
            ...jobIds
          )
          .toArray();
        for (const sr of statusRows) {
          const jid = sr.job_id as number;
          if (!statusMap.has(jid)) statusMap.set(jid, (sr.type as string).replace("job:", ""));
        }
      }

      const jobs = rows.map((row: Record<string, unknown>) => {
        const payload = JSON.parse(row.payload as string) as Record<string, unknown>;
        const data = (payload.data || {}) as Record<string, unknown>;
        return {
          jobId: row.job_id,
          description: data.description || null,
          descriptionCid: data.descriptionCid || null,
          client: data.client || null,
          provider: data.provider || null,
          evaluator: data.evaluator || null,
          status: statusMap.get(row.job_id as number) || "open",
          createdAt: row.ts,
        };
      });

      return Response.json({ jobs });
    }

    // HTTP endpoint for single job detail with event timeline
    const jobDetailMatch = url.pathname.match(/^\/relay\/jobs\/(\d+)$/);
    if (jobDetailMatch) {
      const jobId = Number(jobDetailMatch[1]);
      const rows = this.ctx.storage.sql
        .exec(
          "SELECT type, payload, ts FROM events WHERE job_id = ? ORDER BY ts ASC",
          jobId
        )
        .toArray();

      if (rows.length === 0) {
        return Response.json({ error: "Job not found in relay" }, { status: 404 });
      }

      // Extract description from job:created event
      let description: string | null = null;
      let descriptionCid: string | null = null;
      const timeline = rows.map((row: Record<string, unknown>) => {
        const payload = JSON.parse(row.payload as string) as Record<string, unknown>;
        const data = (payload.data || {}) as Record<string, unknown>;
        if (row.type === "job:created") {
          description = (data.description as string) || null;
          descriptionCid = (data.descriptionCid as string) || null;
        }
        return { type: row.type, data, timestamp: row.ts };
      });

      return Response.json({ jobId, description, descriptionCid, timeline });
    }

    // HTTP endpoint for bids on a job
    if (url.pathname === "/relay/bids") {
      const jobId = Number(url.searchParams.get("jobId") || 0);
      const rows = this.ctx.storage.sql
        .exec(
          "SELECT payload, ts FROM events WHERE type = 'job:bid' AND (? = 0 OR job_id = ?) ORDER BY ts DESC LIMIT 50",
          jobId,
          jobId
        )
        .toArray();

      const bids = rows.map((row: Record<string, unknown>) => {
        const payload = JSON.parse(row.payload as string) as Record<string, unknown>;
        const data = (payload.data || {}) as Record<string, unknown>;
        return {
          jobId: payload.jobId,
          bidder: data.bidder || payload.from,
          proposedBudget: data.proposedBudget,
          pitch: data.pitch,
          timestamp: row.ts,
        };
      });

      return Response.json({ bids });
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({ error: "Expected WebSocket" }, { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const wallet = url.searchParams.get("wallet") || "anonymous";

    const normalizedWallet = wallet.toLowerCase();
    this.ctx.acceptWebSocket(server, [normalizedWallet]);
    // Store wallet as attachment so webSocketMessage can read it via deserializeAttachment
    server.serializeAttachment([normalizedWallet]);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer
  ): Promise<void> {
    if (typeof message !== "string") return;

    try {
      const data = JSON.parse(message) as {
        to?: string;
        type?: string;
        jobId?: number;
        from?: string;
        timestamp?: number;
      };

      if (data.to) {
        // Directed message: route to specific wallet + persist
        const toWallet = data.to.toLowerCase();
        for (const conn of this.ctx.getWebSockets(toWallet)) {
          conn.send(message);
        }
        this.storeEvent(toWallet, data, message);
      } else {
        // Broadcast to all connected clients except sender + persist for each
        for (const conn of this.ctx.getWebSockets()) {
          if (conn !== ws) {
            conn.send(message);
            // Get recipient wallet tag and persist
            const tags = conn.deserializeAttachment?.() as string[] | null;
            if (tags?.[0]) {
              this.storeEvent(tags[0], data, message);
            }
          }
        }
      }

      // Cleanup old events periodically (1 in 20 chance per message)
      if (Math.random() < 0.05) {
        this.ctx.storage.sql.exec(
          "DELETE FROM events WHERE ts < ?",
          Date.now() - SEVEN_DAYS_MS
        );
      }
    } catch {
      // Ignore malformed messages
    }
  }

  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string
  ): Promise<void> {
    ws.close(code, reason);
  }

  private storeEvent(
    wallet: string,
    data: { type?: string; jobId?: number },
    rawMessage: string
  ): void {
    try {
      this.ctx.storage.sql.exec(
        "INSERT INTO events (wallet, type, job_id, payload, ts) VALUES (?, ?, ?, ?, ?)",
        wallet,
        data.type || "unknown",
        data.jobId || 0,
        rawMessage,
        Date.now()
      );
    } catch {
      // Storage write failure is non-fatal
    }
  }
}
