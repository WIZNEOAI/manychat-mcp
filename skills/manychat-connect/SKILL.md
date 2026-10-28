---
name: manychat-connect
description: Connect an agent to ManyChat MCP safely. Use for installation and client setup.
---

# Connect to ManyChat

1. Follow the repository README for supported install and transport instructions. Do not invent package commands.
2. Keep the API key in a local environment or secret manager. Never ask the user to paste it into chat or commit it.
3. For HTTP, configure `/mcp` and attach `X-ManyChat-API-Key` on every request. HTTP has no environment-key fallback.
4. For stdio, use the documented local environment configuration.
5. Verify with a read-only page info operation. Never send as a connectivity test.
6. Explain that current ManyChat schema does not prove which channel produced `last_interaction`; sends fail closed without trusted evidence.
