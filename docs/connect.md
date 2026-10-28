# Client setup

Run the npm package with `npx -y mcp-manychat mcp serve --transport stdio`; no source checkout, branch, or absolute path is required. The package provides `manychat` and `manychat-mcp` binaries.

The local `MANYCHAT_API_KEY` environment variable must reach the **client process and its MCP child**. GUI clients do not necessarily inherit your terminal's environment; configure their launch environment or use a local secret-manager launcher. Never write a literal key into these examples, source control or agent chat. These configurations describe client setup; automated tests cover the server wire protocol, not every third-party client's UI/version.

## Claude Code

With the local environment prepared:

```sh
claude mcp add --transport stdio manychat -- npx -y mcp-manychat mcp serve --transport stdio
```

## Claude Desktop

Merge this into the local `claude_desktop_config.json`, then restart the client with the secret available in its launch environment:

```json
{
  "mcpServers": {
    "manychat": {
      "command": "npx",
      "args": ["-y", "mcp-manychat", "mcp", "serve", "--transport", "stdio"]
    }
  }
}
```

## Cursor

Use the same `mcpServers` JSON in your **user-level** `~/.cursor/mcp.json`. Do not put keys in workspace files. Restart Cursor from the prepared environment.

## Codex

```sh
codex mcp add manychat -- npx -y mcp-manychat mcp serve --transport stdio
```

Check the Codex MCP configuration to ensure `MANYCHAT_API_KEY` is inherited. If the client filters subprocess variables, its local server entry can set `env_vars = ["MANYCHAT_API_KEY"]`; this names the variable without copying its value.

## OpenCode

Merge into the user-level OpenCode config:

```json
{
  "mcp": {
    "manychat": {
      "type": "local",
      "command": ["npx", "-y", "mcp-manychat", "mcp", "serve", "--transport", "stdio"],
      "enabled": true
    }
  }
}
```

## Hermes

Use the MCP setup interface to register a custom stdio server with command `npx` and these arguments:

```json
["-y", "mcp-manychat", "mcp", "serve", "--transport", "stdio"]
```

The corresponding local configuration shape is:

```yaml
mcp_servers:
  manychat:
    command: npx
    args: [-y, mcp-manychat, mcp, serve, --transport, stdio]
```

Keep the key in the local environment/secret manager. Consult the [Hermes MCP guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp) for the installed client's secret-environment support. Restart/reload MCP after changing configuration. Do not modify another profile.

## n8n (HTTP)

In an **MCP Client** or **MCP Client Tool** node:

- Transport: Streamable HTTP.
- Endpoint: `https://YOUR-SERVER/mcp` (a server you control, not a claimed hosted service).
- Authentication: Header Auth credential.
- Header name: `X-ManyChat-API-Key`; put the value in n8n's credential store, not node text or an exported expression.
- First tool: `get_page_info`, with `{}`.

The server needs shared Redis in production. Provisioning or deploying the endpoint is a separate owner-approved step. Use `manychat_header` mode for this header setup. OAuth mode accepts only its own bearer tokens and cannot be bypassed with this header.

## VS Code

In the user MCP configuration (or `.vscode/mcp.json` with **no secrets**), use:

```json
{
  "servers": {
    "manychat": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-manychat", "mcp", "serve", "--transport", "stdio"]
    }
  }
}
```

Launch VS Code with the local environment prepared. Never use a literal key as an argument.

## Verify without sending

1. Call `get_page_info` with `{}`; it performs a GET.
2. List tools and compare with the README inventory.
3. Call `validate_message` with a real `subscriber_id` only when authorized to read that contact. It performs a GET, not a send.
4. Expect `CHANNEL_UNKNOWN` when ManyChat provides no verified interaction-channel evidence. A successful connection does not unlock sending.

`manychat validate ID` checks one subscriber; `manychat call TOOL_NAME JSON` invokes a named tool. Sending and potentially message-triggering CRM writes remain blocked without trusted evidence; no evidence provider is shipped. The flow guard covers dispatch eligibility only: it does not inspect delayed steps or later messages/channels inside a ManyChat flow. An allowlist of approved flows is a possible future control, not implemented. Docker, Render, and OAuth with Redis have not been verified in a real deployment.

`LOG_LEVEL` supports `debug`, `info`, `warn`, and `error` (default `info`).

ManyChat API access requires a suitable paid ManyChat plan. The MCP software is free under AGPL; third-party platform usage is separate.

## Server environment

`MCP_REMOTE_AUTH` (`manychat_header` default or `oauth`), `PORT` (default `3000`), `HOST` (default `0.0.0.0`), and `LOG_LEVEL` configure the runtime. Production requires either `TRUST_PROXY_CIDRS` or `TRUST_PROXY_HOPS` (1–16), not both. Use `TRUST_PROXY_HOPS=1` only behind an exclusive single-proxy ingress such as Render, with direct/shorter paths blocked. `/health` is not rate-limited. OAuth with Redis requires `OAUTH_ENC_KEY` as exactly 64 hexadecimal characters, provided through the secret manager and identical across instances; never copy its value into client configuration. HUMAN_AGENT requires server-side `MANYCHAT_ALLOW_HUMAN_AGENT=1` and actual human support. No tool accepts `human_agent`.
