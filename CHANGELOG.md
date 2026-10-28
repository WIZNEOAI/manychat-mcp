# Changelog

All notable changes follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/); before 1.0, minor releases may break compatibility.

## [Unreleased]

## [0.2.0] - 2026-10-28

0.2.0 reads subscribers and operates the CRM (tags, fields, search). Real message sending stays blocked until a channel-evidence provider ships in 0.3.0: without one, every send returns `CHANNEL_UNKNOWN`. Docker, Render and OAuth with a real Redis have not been tested in a live deployment.

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
- WhatsApp dispatch outside 24 hours blocks. Deprecated Meta tags block. Tools reject `human_agent`; only the server setting `MANYCHAT_ALLOW_HUMAN_AGENT=1` (off by default) enables the HUMAN_AGENT path, still capped at seven days.
- HTTP authentication modes are exclusive; a visitor cannot inherit the process's ManyChat key or bypass OAuth with a ManyChat-key header.
- Node 22 or newer, strict TypeScript, ESM and pinned pnpm replace the old runtime baseline. Patched SDK, Express and validation dependencies replace vulnerable reference versions.
- The package version comes only from package.json. The primary `manychat` bin and documented `manychat-mcp` alias support real `--version`/`-v` output without credentials.
- Tag and custom-field writes that can start ManyChat automations (`add_tag_to_subscriber`, `add_tag_to_subscriber_by_name`, `set_custom_field`, `set_custom_field_by_name`, `set_custom_fields_bulk`, `update_subscriber`) pass the same guard as sends. `create_subscriber` and `set_bot_field` have no subscriber to validate and are blocked with `AUTOMATION_SCOPE_UNKNOWN`.
- OAuth with Redis encrypts stored ManyChat keys with AES-256-GCM (`OAUTH_ENC_KEY`, required in production) and names Redis keys by token hash. `/register` has its own quota, a registration TTL and a global cap. The consent page shows the client name as unverified and the redirect host.
- Production requires `TRUST_PROXY_CIDRS` or `TRUST_PROXY_HOPS`. `/health` sits outside the rate limiter. Responses send `Content-Security-Policy` with `frame-ancestors 'none'`, `X-Frame-Options: DENY` and HSTS.
- Rich-content input currently accepts text, image, video and audio. Cards/buttons/actions are not exposed by this adapter.

### Removed

- Caller-declared messaging windows, policy override flags, raw POST CLI access, automatic POST retries and hosted-product implementation code.
- Personal client settings and unrelated deployment/provider configuration from the copied reference surface.
