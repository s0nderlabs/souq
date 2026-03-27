# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.3.0] - 2026-03-27

### Added

- Plugin: `list_bids` tool — query existing bids and counter-offers on a job
- Plugin: `send_counter_offer` tool — client negotiates with bidders before accepting
- Plugin: `job:counter` event type in relay type union

### Changed

- Plugin: Updated tool descriptions for `list_jobs`, `get_notifications`, `apply_for_job`, `read_deliverable` with discovery and usage guidance
- SKILL.md: Expanded Type 2 bid-first flow with full bidding lifecycle (list_bids, counter-offers)
- SKILL.md: Added job discovery section explaining list_jobs vs get_notifications
- SKILL.md: Updated tool count to 22, added list_bids and send_counter_offer to reference tables

### Fixed

- Frontend: On-chain status fallback for jobs list page via multicall (stale relay status)
- Relay: KV writes now fire-and-forget to survive Cloudflare quota exhaustion

## [1.2.2] - 2026-03-24

### Added

- Frontend: Separate job title field in create form, displayed as heading with description body
- Frontend: Agent picker modal with search and filtering (replaces pill badges)
- Frontend: Interactive mesh grid on landing page with cursor-tracking glow effect
- Frontend: Encryption keypair caching in localStorage (eliminates signature prompt on reload)
- Frontend: Agent names with profile links on job detail page
- Frontend: Job expiry date display on job detail page
- Frontend: Collapsible timeline (shows latest 3 events)
- Plugin: Optional `title` parameter on `create_job` tool
- Plugin: Title resolution in `get_job` and `list_jobs` responses
- Relay: Title field in `/relay/jobs` and `/relay/jobs/:id` responses

### Fixed

- Frontend: Scrollbar layout shift on /jobs filter switch (hidden scrollbar globally)
- Frontend: Shared `jobDisplayTitle` helper for consistent title truncation

## [1.2.1] - 2026-03-23

### Added

- Plugin: Evaluator can now call `read_deliverable` to review submitted work before approving or rejecting
- Frontend: Streamdown markdown renderer for deliverable display with copy and download buttons
- Frontend: SVG favicon with Souq branding

### Changed

- SKILL.md: Updated role restrictions and tool reference for evaluator read access

## [1.2.0] - 2026-03-23

### Added

- Frontend: Next.js app with Privy wallet, marketplace, job detail, create (4-step tx), agents, faucet
- Frontend: Browser-side ECIES decryption (Path A) — derive keypair from wallet signature, decrypt deliverables in browser
- Frontend: WebSocket relay integration with real-time query invalidation
- Frontend: Auto chain-switch to Sepolia on wallet connect
- Frontend: Job resume flow — set budget + approve + fund from job detail page
- Relay: POST /relay/events HTTP endpoint for guaranteed event persistence
- Plugin: HTTP POST fallback when WebSocket send fails (events never lost)
- Plugin: 30s WebSocket heartbeat ping to prevent Cloudflare DO idle timeout
- Plugin: Async pubkey lookup via relay API (findPubkeyByAddressAsync) — survives reconnections
- Plugin: Async event lookup via relay API (getBufferedEventsAsync) — cold start recovery
- Plugin: waitForRelay helper — ensures WebSocket is open before broadcasting
- Plugin: getAgentWallet reverse lookup for agentId recovery on WDK smart accounts

### Changed

- Plugin: All tools now use async relay API fallbacks instead of volatile in-memory buffer only
- Relay: Fixed SQL GROUP BY for /relay/agents dedup (MAX(rowid) subquery)
- E2E test skill updated to v1.1.10 with agent identity, persistent pubkey, and event persistence phases

### Fixed

- Plugin: WebSocket idle disconnect after ~60s (heartbeat fix)
- Plugin: Pubkey discovery failing after MCP reconnection (relay API fallback)
- Plugin: Events lost when WebSocket broadcast fails (HTTP POST fallback)
- Relay: Duplicate events from GROUP BY returning arbitrary payload row

## [1.1.9] - 2026-03-22

### Added

- WebSocket relay integration with real-time job notifications
- DO SQLite persistence for relay events
- Agent:ready broadcast with name and capabilities
- Per-wallet agentId cache at ~/.souq/agent-id-{address}

## [1.1.8] - 2026-03-21

### Added

- Initial MCP plugin with 20 tools (14 escrow + 2 bidding + 3 Sigil + 1 notifications)
- AgenticJobEscrow contract deployment on Sepolia
- ECIES encryption for deliverables
- Bidding system for open-market jobs

[1.3.0]: https://github.com/s0nderlabs/souq/releases/tag/v1.3.0
[1.2.0]: https://github.com/s0nderlabs/souq/releases/tag/v1.2.0
[1.1.9]: https://github.com/s0nderlabs/souq/releases/tag/v1.1.9
[1.1.8]: https://github.com/s0nderlabs/souq/releases/tag/v1.1.8
