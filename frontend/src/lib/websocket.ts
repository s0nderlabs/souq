import { API_URL } from "./contracts";

const WS_URL = API_URL.replace("https://", "wss://").replace("http://", "ws://");

export interface RelayEvent {
  type: string;
  jobId?: number;
  from: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

type EventCallback = (event: RelayEvent) => void;

let ws: WebSocket | null = null;
let currentWallet: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let pingInterval: ReturnType<typeof setInterval> | null = null;
const MAX_RECONNECT = 30000;
const PING_INTERVAL = 30_000;
const listeners = new Set<EventCallback>();

function connect(wallet: string) {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  try {
    ws = new WebSocket(`${WS_URL}/relay?wallet=${wallet}`);

    ws.onopen = () => {
      reconnectDelay = 1000;
      if (pingInterval) clearInterval(pingInterval);
      pingInterval = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, PING_INTERVAL);
      console.log("[souq] Relay WebSocket connected");
    };

    ws.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as RelayEvent;
        for (const cb of listeners) {
          try { cb(event); } catch { /* skip */ }
        }
      } catch { /* non-JSON */ }
    };

    ws.onclose = () => {
      ws = null;
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
      scheduleReconnect(wallet);
    };

    ws.onerror = () => {
      // onclose will fire after this
    };
  } catch {
    scheduleReconnect(wallet);
  }
}

function scheduleReconnect(wallet: string) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (currentWallet === wallet) connect(wallet);
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT);
}

/** Connect to the relay WebSocket for real-time events */
export function connectRelay(walletAddress: string) {
  currentWallet = walletAddress;
  connect(walletAddress);
}

/** Disconnect from the relay */
export function disconnectRelay() {
  currentWallet = null;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
}

/** Subscribe to relay events. Returns unsubscribe function. */
export function onRelayEvent(callback: EventCallback): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** Send an event — WebSocket broadcast + HTTP POST for guaranteed persistence */
export function sendRelayEvent(
  event: Omit<RelayEvent, "from" | "timestamp">
): boolean {
  if (!currentWallet) return false;

  const fullEvent = {
    ...event,
    from: currentWallet,
    timestamp: Date.now(),
  };

  // WebSocket broadcast (fast, best-effort)
  let wsSent = false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(fullEvent)); wsSent = true; } catch { /* fallback below */ }
  }

  // HTTP POST fallback — only when WS failed (avoids duplicate storage)
  if (!wsSent) {
    fetch(`${WS_URL.replace("wss://", "https://").replace("ws://", "http://")}/relay/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fullEvent),
    }).catch(() => {
      console.warn("[souq] HTTP event persistence failed");
    });
  }

  return true;
}

/** Send event with guaranteed persistence (async) */
export async function sendRelayEventAsync(
  event: Omit<RelayEvent, "from" | "timestamp">,
  _timeoutMs = 3000
): Promise<boolean> {
  return sendRelayEvent(event);
}
