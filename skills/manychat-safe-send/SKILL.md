---
name: manychat-safe-send
description: Validate a ManyChat message before sending. Use before every messaging action.
---

# Safe send procedure

1. Identify the intended subscriber, channel, content, and purpose. Do not infer missing values.
2. Call `validate_message` with the proposed send details using the server's documented schema.
3. Treat caller-supplied channel, last-interaction time, ad origin, and policy tag claims as untrusted. The guard needs server-derived data and trusted provider evidence.
4. If validation blocks or evidence is missing, do not send by MCP, CLI, flow, retry, or another route. Explain the reason and ask for a human decision where appropriate.
5. If validation permits, show the recipient and exact content and obtain the user's explicit approval before executing the send.
6. Report the actual tool result. Do not claim delivery based only on a successful request.

The current official ManyChat schema does not tie `last_interaction` to a channel. A trusted evidence extension may be required; absent that, expect sends to fail closed.
