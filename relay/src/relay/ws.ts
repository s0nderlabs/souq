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
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // HTTP endpoint for fetching missed events
    if (url.pathname === "/relay/events") {
      const wallet = url.searchParams.get("wallet");
      if (!wallet) {
        return Response.json({ error: "wallet param required" }, { status: 400 });
      }
      const since = Number(url.searchParams.get("since") || 0);
      const rows = this.ctx.storage.sql
        .exec(
          "SELECT id, wallet, type, job_id, payload, ts FROM events WHERE wallet = ? AND ts > ? ORDER BY ts ASC LIMIT 100",
          wallet.toLowerCase(),
          since
        )
        .toArray();

      // Parse payload JSON for each row
      const events = rows.map((row: Record<string, unknown>) => ({
        ...(JSON.parse(row.payload as string) as Record<string, unknown>),
        type: row.type,
        jobId: row.job_id,
        timestamp: row.ts,
      }));

      return Response.json(events);
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({ error: "Expected WebSocket" }, { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const wallet = url.searchParams.get("wallet") || "anonymous";

    this.ctx.acceptWebSocket(server, [wallet.toLowerCase()]);
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
        const senderTags = ws.deserializeAttachment?.() as string[] | null;
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
