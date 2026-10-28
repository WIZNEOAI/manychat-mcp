# Messaging policy and sources

This document separates published platform rules from what this server can currently verify. It does not promise that a send will succeed. The current ManyChat schema does not associate `last_interaction` with a channel, so the guard fails closed unless a trusted evidence provider supplies that link. A channel identifier on an account is not proof of the interaction channel.

| Rule | Guard behavior | Source and date |
|---|---|---|
| Standard messaging window | Require server-derived interaction evidence and enforce the channel's 24-hour window. Missing channel or timestamp evidence blocks. | Meta WhatsApp pricing and messaging policy: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing (page updated 2026-09-30; consulted 2026-10-28); ManyChat Page API Swagger, `GET /fb/subscriber/getInfo`: https://api.manychat.com/swagger/compileJson?type=Page_API (schema consulted 2026-10-27). |
| WhatsApp outside 24 hours | Block. This adapter does not implement WhatsApp templates through `sendContent`. Use approved templates in ManyChat's interface, subject to its policy checks. This server does not unlock an out-of-window send through `send_flow`. | [ManyChat Swagger](https://api.manychat.com/swagger/compileJson?type=Page_API), `sendContent` request contract and error 3011; [official Dynamic Content format](https://manychat.github.io/dynamic_block_docs/) has no WhatsApp template payload. Contracts reviewed 2026-10-28. |
| Ad-origin extension | Permit up to seven days only when a trusted evidence source verifies qualifying ad origin. Never accept an agent's claim. Current official ManyChat schema alone does not establish this evidence. | Meta Business Messaging changelog, 2026-09-28, Click-to-Messenger/Click-to-Direct window: https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog |
| Deprecated Messenger/Instagram tags | Block `CONFIRMED_EVENT_UPDATE`, `POST_PURCHASE_UPDATE`, and `ACCOUNT_UPDATE`. The presence of an old Swagger example does not make a deprecated tag valid. | Meta Messenger Platform changelog, 2026-03-27; effective 2026-04-27: https://developers.facebook.com/documentation/business-messaging/messenger-platform/changelog |
| HUMAN_AGENT | Do not treat as automation permission. It requires a human response, App Review, and business verification, and applies for up to seven days under Meta's conditions. | Meta Human Agent feature reference: https://developers.facebook.com/docs/features-reference/human-agent/ (consulted 2026-10-27). |
| Promotional content under any tag | Block. A tag cannot turn promotional content into a permitted service message. | Meta business messaging policies and category rules: https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing; policy application must follow current platform documentation. |
| Telegram, SMS, Email | Outside this Meta policy wedge. This project makes no send-support promise for these channels. | Project scope decision (2026-10-27); not a claim about the capabilities of ManyChat or those platforms. |
| TikTok | No confirmed sending capability; make no send-support claim. | Capability not confirmed in the consulted official ManyChat schema (2026-10-27). |

## CRM writes and flow limits

Version 0.2.0 supports reads and CRM operations, but CRM mutations that can trigger a message are not an unguarded automation promise. Tag and custom-field writes use the message guard; absent a trusted evidence provider they are blocked, just like sends. No evidence provider is shipped or configured by default. Other mutations (subscriber create/update, tag removal, and bot-field writes) are distinct operations whose message-trigger behavior is not established here; treat them as an operational risk and do not assume they are safe to automate.

Flow eligibility is checked only at dispatch time. A flow is opaque to this server: delayed steps, later messages, and channel changes inside ManyChat are not inspected or covered by the current-window check. The sender must review a flow's contents and behavior. A flow allowlist is a possible future control, not implemented.

## Evidence and failure behavior

ManyChat's `getInfo` response may contain `last_interaction` in W3C format or null, and may include identifiers such as `ig_id`, `whatsapp_phone`, `whatsapp_bsuid`, `whatsapp_username`, and `optin_whatsapp`. It does not expose an unambiguous channel for the last interaction or separate per-channel timestamps. The guard cannot infer channel from those identifiers. Until trusted evidence links the interaction, send requests fail closed with a reason and do not call the send endpoint.

Meta's standard window is 24 hours. The seven-day ad-origin window is an exception, not a default. Without verified origin evidence, the exception does not apply. HUMAN_AGENT is a human-support path, not a way for an automated agent to message for seven days.

## Source maintenance

Recheck official Meta and ManyChat sources before changing these rules. If documentation conflicts with this table, record the source and date, resolve the policy, then update code, tests, and docs together. Do not turn a provider's example payload into evidence of current permission.
