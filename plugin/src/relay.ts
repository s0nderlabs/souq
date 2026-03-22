// relay.ts — WebSocket client for the Souq relay (Durable Object)
// Connects to the relay for real-time job event broadcasting/receiving.
// Copyright (c) 2026 s0nderlabs

import WebSocket from "ws";
import { getSouqApiUrl } from "./config.js";

// ── Types ──

export interface RelayEvent {
  type: "job:created" | "job:funded" | "job:submitted" | "job:completed" | "job:rejected" | "job:provider_set" | "job:budget_set";
  jobId: number;
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
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
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

  // Broadcast to relay (fire-and-forget)
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(fullEvent));
    } catch {
      // Relay broadcast failure is non-fatal
    }
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
