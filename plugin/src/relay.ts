// relay.ts — WebSocket client for the Souq relay (Durable Object)
// Connects to the relay for real-time job event broadcasting/receiving.
// Copyright (c) 2026 s0nderlabs

import WebSocket from "ws";
import { getSouqApiUrl } from "./config.js";

// ── Types ──

export interface RelayEvent {
  type: "job:created" | "job:funded" | "job:submitted" | "job:completed" | "job:rejected" | "job:provider_set" | "job:budget_set" | "job:bid" | "job:counter" | "agent:ready";
  jobId?: number;
  from: string;
  timestamp: number;
  data?: Record<string, unknown>;
  to?: string;
}

type RelayEventCallback = (event: RelayEvent) => void;

// ── Singleton State ──

let ws: WebSocket | null = null;
let walletAddress: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
const PING_INTERVAL = 30_000; // 30s heartbeat keeps Cloudflare DO connection alive
const listeners: RelayEventCallback[] = [];
const eventBuffer: RelayEvent[] = [];
const MAX_BUFFER_SIZE = 100;

// ── Connect ──

export function connectRelay(wallet: string): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return; // already connected
  }

  walletAddress = wallet;
  const apiUrl = getSouqApiUrl();
  const wsUrl = apiUrl.replace("https://", "wss://").replace("http://", "ws://");
  const url = `${wsUrl}/relay?wallet=${wallet}`;

  try {
    ws = new WebSocket(url);

    ws.on("open", () => {
      reconnectDelay = 1000; // reset on success
      // Heartbeat to keep Cloudflare DO connection alive
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send("ping");
        }
      }, PING_INTERVAL);
      console.error(`[souq] Relay connected: ${wallet.slice(0, 10)}...`);

      // Fetch missed events from DO SQLite (persisted while disconnected)
      const lastTs = eventBuffer.length > 0
        ? eventBuffer[eventBuffer.length - 1].timestamp
        : 0;
      fetch(`${apiUrl}/relay/events?wallet=${wallet}&since=${lastTs}`)
        .then(res => res.ok ? res.json() : [])
        .then((events: unknown) => {
          const evts = events as RelayEvent[];
          if (evts.length > 0) {
            console.error(`[souq] Recovered ${evts.length} missed event(s)`);
            for (const e of evts) {
              eventBuffer.push(e);
              if (eventBuffer.length > MAX_BUFFER_SIZE) eventBuffer.shift();
              for (const cb of listeners) {
                try { cb(e); } catch { /* skip */ }
              }
            }
          }
        })
        .catch(() => {}); // non-fatal
    });

    ws.on("message", (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString()) as RelayEvent;
        // Add to buffer
        eventBuffer.push(event);
        if (eventBuffer.length > MAX_BUFFER_SIZE) {
          eventBuffer.shift();
        }
        // Notify listeners
        for (const cb of listeners) {
          try { cb(event); } catch { /* listener error — skip */ }
        }
      } catch {
        // Non-JSON message — ignore
      }
    });

    ws.on("close", () => {
      ws = null;
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      scheduleReconnect();
    });

    ws.on("error", (err) => {
      console.error(`[souq] Relay error: ${err.message}`);
      // close event will fire after error, triggering reconnect
    });
  } catch {
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (!walletAddress) return;
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (walletAddress) {
      connectRelay(walletAddress);
    }
  }, reconnectDelay);

  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

// ── Wait for connection ──

export function waitForRelay(timeoutMs = 5000): Promise<boolean> {
  if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve(true);
  return new Promise((resolve) => {
    const start = Date.now();
    const check = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        clearInterval(check);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(check);
        resolve(false);
      }
    }, 100);
  });
}

// ── Send Event ──

export function sendRelayEvent(event: Omit<RelayEvent, "from" | "timestamp">): void {
  const fullEvent: RelayEvent = {
    ...event,
    from: walletAddress || "unknown",
    timestamp: Date.now(),
  };

  // Buffer own events locally (so get_notifications shows our actions too)
  eventBuffer.push(fullEvent);
  if (eventBuffer.length > MAX_BUFFER_SIZE) {
    eventBuffer.shift();
  }

  // WebSocket broadcast (fast, best-effort)
  let wsSent = false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(fullEvent));
      wsSent = true;
    } catch {
      // WebSocket send failed — HTTP fallback below
    }
  }

  // HTTP POST fallback — only when WS failed (avoids duplicate storage)
  if (!wsSent) {
    const apiUrl = getSouqApiUrl();
    const wallet = walletAddress || fullEvent.from;
    fetch(`${apiUrl}/relay/events?wallet=${wallet}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullEvent),
    })
      .then((res) => {
        if (!res.ok) {
          console.error(`[souq] Event ${fullEvent.type} HTTP fallback failed: ${res.status}`);
        }
      })
      .catch(() => {
        console.error(`[souq] Event ${fullEvent.type} lost — both WS and HTTP failed`);
      });
  }
}

// ── Listen ──

export function onRelayEvent(callback: RelayEventCallback): void {
  listeners.push(callback);
}

// ── Read Buffer ──

export function getBufferedEvents(since?: number, limit = 50): RelayEvent[] {
  let events = since
    ? eventBuffer.filter(e => e.timestamp > since)
    : [...eventBuffer];
  return events.slice(-limit);
}

/** Async version — tries buffer first, falls back to relay API for persistent events */
export async function getBufferedEventsAsync(since?: number, limit = 50): Promise<RelayEvent[]> {
  const local = getBufferedEvents(since, limit);
  if (local.length > 0) return local;

  // Buffer is warm but nothing matched the filter — no API call needed
  if (eventBuffer.length > 0) return [];

  // Buffer truly empty (cold start) — fetch from relay API
  if (!walletAddress) return [];
  try {
    const apiUrl = getSouqApiUrl();
    const params = new URLSearchParams({ wallet: walletAddress, limit: String(limit) });
    if (since) params.set("since", String(since));
    const res = await fetch(`${apiUrl}/relay/events?${params}`);
    if (!res.ok) return [];
    const events = await res.json() as RelayEvent[];
    // Backfill buffer so future sync calls work
    for (const e of events) {
      eventBuffer.push(e);
      if (eventBuffer.length > MAX_BUFFER_SIZE) eventBuffer.shift();
    }
    return events;
  } catch {
    return [];
  }
}

// ── Pubkey Lookup ──

export function findPubkeyByAddress(address: string): string | null {
  const addr = address.toLowerCase();
  // Check local buffer first (fastest)
  for (let i = eventBuffer.length - 1; i >= 0; i--) {
    const e = eventBuffer[i];
    if (e.type === "agent:ready" && e.from.toLowerCase() === addr) {
      return (e.data as Record<string, string>)?.encryptionPublicKey || null;
    }
  }
  return null;
}

/** Async pubkey lookup — tries buffer first, then queries relay API as fallback */
export async function findPubkeyByAddressAsync(address: string): Promise<string | null> {
  // Try local buffer first
  const cached = findPubkeyByAddress(address);
  if (cached) return cached;

  // Fallback: query relay /relay/agents (persistent, survives reconnects)
  try {
    const apiUrl = getSouqApiUrl();
    const res = await fetch(`${apiUrl}/relay/agents?limit=100`);
    if (!res.ok) return null;
    const data = await res.json() as { agents: Array<{ address: string; encryptionPublicKey: string | null }> };
    const agent = data.agents.find(
      (a) => a.address.toLowerCase() === address.toLowerCase()
    );
    if (agent?.encryptionPublicKey) {
      // Cache it in the buffer so future lookups are instant
      eventBuffer.push({
        type: "agent:ready",
        from: agent.address,
        timestamp: Date.now(),
        data: { address: agent.address, encryptionPublicKey: agent.encryptionPublicKey },
      });
      return agent.encryptionPublicKey;
    }
  } catch {
    // Non-fatal
  }
  return null;
}

// ── Disconnect ──

export function disconnectRelay(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  walletAddress = null;
  reconnectDelay = 1000;
}
