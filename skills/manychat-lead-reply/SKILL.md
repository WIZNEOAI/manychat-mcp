---
name: manychat-lead-reply
description: Draft a safe reply to a ManyChat lead. Use when preparing a lead response.
---

# Reply to a lead

1. Retrieve the subscriber by an explicit identifier and inspect available context.
2. Draft a concise response in the business's voice. Do not invent facts, offers, consent, channel, or interaction time.
3. Use `validate_message` before any send. The guard may reject because channel evidence is unavailable; stop when it does.
4. Show the recipient and final text to the user and obtain explicit approval before sending.
5. Never treat HUMAN_AGENT as permission for an automated reply. It is a human-support allowance with platform requirements.
