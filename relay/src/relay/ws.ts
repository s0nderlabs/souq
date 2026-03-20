import { DurableObject } from "cloudflare:workers";
import type { Env } from "../types";

/**
 * SouqRelay Durable Object
 *
 * WebSocket relay for real-time communication between Souq agents.
 * Supports directed messages (via `to` field) and broadcast.
 * Connections are tagged by wallet address for routing.
 */
export class SouqRelay extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Tag the connection with the wallet address from query param
    const url = new URL(request.url);
    const wallet = url.searchParams.get("wallet") || "anonymous";

    this.ctx.acceptWebSocket(server, [wallet]);
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
      const data = JSON.parse(message) as { to?: string };

      if (data.to) {
        // Directed message: route to specific wallet
        for (const conn of this.ctx.getWebSockets(data.to)) {
          conn.send(message);
        }
      } else {
        // Broadcast to all connected clients except the sender
        for (const conn of this.ctx.getWebSockets()) {
          if (conn !== ws) conn.send(message);
        }
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
}
