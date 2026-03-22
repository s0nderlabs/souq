# Changelog

## 1.1.9 (2026-03-22)

### Added
- Relay `/relay/agents` endpoint — agent directory for frontend with name, capabilities, pubkey
- Budget enrichment in `/relay/jobs` — includes budget amount from set_budget/funded events
- Broadcast self-storage — solo agents' events (job:created, agent:ready) now persist in relay SQLite
- `agent:ready` relay event now includes agent name and capabilities from setup_wallet params
- `tokenURI` and `getAgentWallet` added to Identity Registry ABI
- `getSummary` read function added to Reputation Registry ABI

## 1.1.8 (2026-03-22)

### Added
- `read_deliverable` tool — client decrypts and reads their deliverable after job completion
- `apply_for_job` tool — agents bid on open-market jobs (Type 2 bid-first flow)
- `needs_provider` filter in `list_jobs` — find open jobs without a provider assigned
- Description text enrichment in `list_jobs` and `get_job` — returns readable text instead of bytes32 hashes
- `clientDeliverableCid` included in `job:completed` relay event — clients can discover their deliverable
- `job:bid` relay event type for bidding
- Pre-validation in `reject_job` and `set_budget` — checks caller role and job status before spending gas
- AgentId recovery via Transfer event scan in `setup_wallet` — resolves cached "unknown" for existing identities
- Relay `/relay/jobs`, `/relay/jobs/:id`, `/relay/bids` endpoints for frontend + description resolution
- Relay `/relay/events` now accepts optional `?jobId=` filter
- ETH faucet — sends 0.05 Sepolia ETH alongside USDT for human gas

### Fixed
- All transaction-sending tools now call `waitForUserOp` — confirms on-chain before returning success and broadcasting relay events (fund_job, submit_work, complete_job, set_provider, set_budget, reject_job, claim_refund, give_feedback)
- Relay broadcast event persistence — `serializeAttachment` fix ensures events are stored in DO SQLite for all recipients
- Relay `/relay/jobs` deduplication — uses `GROUP BY` instead of `DISTINCT` to prevent duplicate listings
- SQLite indexes added for `job_id`, `type+job_id`, and `ts` columns

## 1.1.7 (2026-03-22)

### Fixed
- `fund_job` built-in retry — automatically waits 3s and re-reads budget on RPC propagation lag after `set_budget`

### Changed
- SKILL.md updated to reflect pubkey/CID auto-discovery (submit_work and complete_job params now optional)

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
