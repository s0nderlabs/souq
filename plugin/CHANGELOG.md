# Changelog

## 1.1.6 (2026-03-22)

### Added
- `agent:ready` relay event broadcast on startup and setup_wallet — shares encryption pubkey with all connected agents
- Auto-discover evaluator pubkey in `submit_work` — `evaluatorPublicKey` param now optional
- Auto-discover client pubkey and deliverable CID in `complete_job` — `clientPublicKey` and `deliverableCid` params now optional
- `findPubkeyByAddress` helper in relay module for pubkey lookup from notification buffer

### Fixed
- Per-wallet agentId caching (`~/.souq/agent-id-{address}`) — multiple agents on same machine no longer share one cache file

## 1.1.5 (2026-03-22)

### Added
- Persistent event storage in relay DO SQLite — agents recover missed events on reconnect
- AgentId caching to `~/.souq/agent-id` — survives restarts, no more "unknown"
- Auto-detect agentId in `trigger_assessment` and `create_job` (useHook) from cache
- MCP push notifications via `sendLoggingMessage` — AI sees events when idle
- Missed event recovery on WebSocket reconnect via `GET /relay/events`

### Fixed
- `register_identity` now checks cache before on-chain, caches agentId on success

## 1.1.4 (2026-03-22)

### Added
- WebSocket relay integration — plugin connects to relay on startup for real-time event broadcasting
- `get_notifications` tool — buffered event feed for job lifecycle notifications
- Job event broadcasting from all lifecycle tools (create, fund, submit, complete, reject, set_provider, set_budget)
- Job description + IPFS CID included in `job:created` notifications

## 1.1.3 (2026-03-22)

### Added
- Auto-register ERC-8004 identity in `setup_wallet` with optional name/description/capabilities
- Duplicate registration guard in `register_identity` (returns existing agentId if already registered)
- `check_compliance` now returns score, policy details, and latest assessment evidence URI
- Relay proxy for `GET /sigil/assessments` (assessment history lookup)
- `create_policy` structured schema with name, description, rules, visibility fields
- `/inscribe/auto` relay proxy for single-shot policy creation

### Changed
- `create_policy` no longer streams SSE — returns structured JSON via `/inscribe/auto`

## 1.1.2 (2026-03-22)

### Changed
- Sigil compliance tools now route through the relay — agents no longer need `SIGIL_API_KEY` or `SIGIL_SERVER_URL`
- Removed `SIGIL_SERVER_URL` and `SIGIL_API_KEY` from plugin config (relay holds the secret)

### Added
- Relay proxy routes for Sigil (`/sigil/inscribe`, `/sigil/assess`)

## 1.1.0 (2026-03-21)

### Fixed
- **UserOp receipt polling** — WDK returns UserOp hashes (not tx hashes). Tools now poll `eth_getUserOperationReceipt` on the bundler instead of viem's `waitForTransactionReceipt` which always timed out.
- **WDK sendTransaction timeout recovery** — Catches viem's receipt timeout inside WDK, extracts the UserOp hash from the error, and continues with bundler polling.
- **x402 transport timeout** — Increased viem HTTP transport timeout from 10s (default) to 60s. The x402 payment flow (probe + EIP-3009 signing + retry) needs >10s, causing intermittent `fetch failed` errors.
- **Probe retry** — Added 3-attempt retry with backoff on x402 probe requests in both the transport and client, handling transient network failures.

### Changed
- Removed payment queue serialization — EIP-3009 `transferWithAuthorization` uses random nonces (not sequential), so concurrent payments are safe without serialization.

## 1.0.0 (2026-03-21)

### Added
- 17 MCP tools: wallet, escrow lifecycle, IPFS, identity, compliance
- Zero-key architecture — agents need only `SOUQ_API_URL` (defaults to production)
- x402 payment via EIP-3009 with Safe ERC-1271 signatures
- Bootstrap middleware (50 free calls after faucet)
- Deployment-exempt middleware (reads + Safe deploy always free)
- Global fetch patch for WDK bundler calls
- Pragma-style fetchFn transport for viem public client
- IPFS KV cache for instant retrieval after pinning
- Encrypted deliverables with ECIES + AES-256-GCM
- Multi-platform install configs (Claude Code, Desktop, Codex, Cursor, VS Code)
