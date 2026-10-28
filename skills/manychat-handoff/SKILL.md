---
name: manychat-handoff
description: Prepare a safe handoff from an agent to a human operator. Use when escalation is needed.
---

# Hand off to a human

1. Summarize the subscriber's request and relevant context without exposing unnecessary personal data.
2. Do not use HUMAN_AGENT as a generic automation tag. Meta's allowance requires an actual human response, App Review, and business verification, and lasts at most seven days under its conditions.
3. Do not send a handoff message unless the shared policy guard validates it. Channel evidence may be unavailable and cause a fail-closed result.
4. Tell the user when the system cannot verify eligibility. Do not retry through another tool, flow, or CLI path.
5. Record only the minimum operational information required by the configured workflow; do not claim a durable audit feature unless it exists.
