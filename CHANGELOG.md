# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/); before 1.0, minor releases may break compatibility.

## [Unreleased]

## [0.2.0] - 2026-10-28

This entry documents package version 0.2.0; it does not assert that a release or npm publication has occurred.

### Added

- A shared execution engine for 28 MCP tools and the CLI, with validated operation inputs.
- A fail-closed send guard that fetches subscriber information for each validation and dispatch. A trusted evidence adapter must identify the channel of the returned interaction; the shipped ManyChat schema alone cannot establish it.
- An evidence-gated, channel-matched seven-day Click-to-Messenger/Direct window measured from the first ad-origin user message.
- Stateless Streamable HTTP and stdio for MCP 2026-07-28, with legacy stdio compatibility.
- Per-IP and per-credential-hash rate budgets, shared Redis counters in production, body limits, origin checks, upstream/socket deadlines and minimal health responses.
- OAuth single-use code and refresh-token concurrency tests for memory and mocked Redis GETDEL.
- Offline caller-level tests, isolated-process wire tests and a behavioral mutation check.
- Self-hosted CI with a same-repository PR guard and a manual, opt-in npm provenance workflow.
- Non-root multi-stage container configuration and a declarative Starter service blueprint with automatic deployment off.
- English and Mexican Spanish setup guides, five agent skills, community templates, policy sources and manual release guidance.
- Architecture-only extension contracts for a future tenant key vault, send audit and idempotency store. These features are not implemented.

### Changed

- All CLI/MCP sends, including flow dispatch, use the shared guard; ambiguous or missing channel evidence blocks without an upstream POST.
- WhatsApp dispatch outside 24 hours blocks. Deprecated Meta tags block, and HUMAN_AGENT requires an explicit human/non-promotional declaration with an App Review and business-verification warning.
- HTTP authentication modes are exclusive; a visitor cannot inherit the process's ManyChat key or bypass OAuth with a ManyChat-key header.
- Node 22 or newer, strict TypeScript, ESM and pinned pnpm replace the old runtime baseline. Patched SDK, Express and validation dependencies replace vulnerable reference versions.
- The package version comes only from package.json. The primary `manychat` bin and documented `manychat-mcp` alias support real `--version`/`-v` output without credentials.
- Rich-content input currently accepts text, image, video and audio. Cards/buttons/actions are not exposed by this adapter.

### Removed

- Caller-declared messaging windows, policy override flags, raw POST CLI access, automatic POST retries and hosted-product implementation code.
- Personal client settings and unrelated deployment/provider configuration from the copied reference surface.
