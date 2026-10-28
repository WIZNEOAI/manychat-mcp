# Contributing

Thanks for helping improve ManyChat MCP. Keep changes focused and explain user impact, security implications, and tests.

## Local development

Install Node >=22 and pnpm 11.25.0, then run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:mutation
gitleaks git --no-banner --redact
```

`pnpm test` needs no ManyChat account and blocks external fetches. Socket tests start isolated local child processes and clean them up. The optional `pnpm smoke:readonly` is separate: set `MANYCHAT_API_KEY` and `MANYCHAT_SMOKE_SUBSCRIBER_NAME` locally first. It makes only read requests; never use a real recipient as a send test.

See [architecture](docs/architecture.md) for the source map: tools and shared operations live in `src/core/engine.ts`, policy in `src/policy/guard.ts`, HTTP/auth boundaries in `src/mcp/` and `src/auth/`. [Client setup](docs/connect.md) covers source installation. No npm publication is needed to develop or test.

## Before opening a pull request

- Open an issue for significant behavior or API changes so maintainers can discuss scope.
- Keep secrets, account data, and real subscriber identifiers out of commits, logs, screenshots, and fixtures.
- For every send path, use the shared policy guard. Never infer the interaction channel from connected account identifiers or accept policy evidence from agent-controlled input.
- Add tests for both allowed and blocked cases, including missing evidence and upstream errors.
- Update the English and Mexican Spanish documentation when user-facing behavior changes. Avoid voseo in Spanish copy.
- Run the repository's documented checks and include their actual results in the pull request.

## Pull requests

Use the pull request template. Describe the behavior change, the risk, how reviewers can verify it, and any follow-up work. Do not claim a release, deployment, or live send unless it happened and you verified it.

## Licensing

The repository retains its existing license and required attribution. By submitting a contribution, you agree that maintainers may distribute it under the repository's license. Do not submit code or assets you cannot legally contribute.
