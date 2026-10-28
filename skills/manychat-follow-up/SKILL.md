---
name: manychat-follow-up
description: Plan a ManyChat follow-up within verified messaging windows. Use for lead follow-up.
---

# Follow up safely

1. Read subscriber information and use only server-derived interaction evidence.
2. Do not calculate eligibility from an agent estimate or user-declared timestamp/channel. Current ManyChat schema does not link `last_interaction` to a channel, so the guard may fail closed.
3. Treat 24 hours as the standard window. Use up to seven days only if trusted evidence verifies qualifying ad origin.
4. Outside the eligible window, do not attempt a workaround. ManyChat `sendContent` does not send WhatsApp templates.
5. Run `validate_message` for the proposed content and stop on any rejection. Ask the user before a send.
