import { z } from "zod";

export const channelSchema = z.enum([
  "messenger",
  "instagram",
  "whatsapp",
  "sms",
  "email",
  "telegram",
  "tiktok",
]);
export type Channel = z.infer<typeof channelSchema>;
export const OUTSIDE_META_WEDGE: ReadonlySet<Channel> = new Set([
  "sms",
  "email",
  "telegram",
]);
export interface InteractionEvidence {
  subscriberId: number;
  channel: Channel;
  lastUserInteractionAt: string;
  /** Provided by a verified server-side event source, never tool arguments. */
  source: "verified-webhook";
  adReferral?: {
    entryPoint: "click-to-messenger" | "click-to-direct";
    firstUserMessageAt: string;
    verified: true;
  };
}
export interface MessageIntent {
  message_tag?: string;
  promotional?: boolean;
  human_agent?: boolean;
}
export interface Verdict {
  allowed: boolean;
  code: string;
  message: string;
  channel?: Channel;
  warnings: string[];
}
export function evaluatePolicy(
  evidence: InteractionEvidence,
  intent: MessageIntent,
  now = Date.now(),
): Verdict {
  const result = (
    allowed: boolean,
    code: string,
    message: string,
    warnings: string[] = [],
  ): Verdict => ({
    allowed,
    code,
    message,
    channel: evidence.channel,
    warnings,
  });
  const tag = intent.message_tag;
  if (tag && intent.promotional !== false)
    return result(
      false,
      "PROMOTION_UNDER_TAG",
      "Tagged content must be explicitly non-promotional. Classification is the sender's responsibility.",
    );
  if (
    tag &&
    [
      "CONFIRMED_EVENT_UPDATE",
      "POST_PURCHASE_UPDATE",
      "ACCOUNT_UPDATE",
    ].includes(tag)
  )
    return result(
      false,
      "TAG_DEPRECATED",
      "Meta removed this message tag on 2026-04-27.",
    );
  if (tag && tag !== "HUMAN_AGENT")
    return result(false, "UNKNOWN_TAG", "Unknown message tag.");
  if (OUTSIDE_META_WEDGE.has(evidence.channel))
    return result(
      true,
      "OUTSIDE_META_WEDGE",
      "Outside the Meta messaging guard; this is not a claim of API sending support.",
    );
  if (evidence.channel === "tiktok")
    return result(
      false,
      "UNSUPPORTED_CHANNEL",
      "TikTok sending is not verified for this API.",
    );
  const last = Date.parse(evidence.lastUserInteractionAt);
  if (!Number.isFinite(last) || last > now)
    return result(
      false,
      "INVALID_INTERACTION",
      "A valid, non-future user interaction timestamp is required.",
    );
  const age = now - last;
  if (evidence.channel === "whatsapp") {
    if (tag)
      return result(
        false,
        "WHATSAPP_TAG_UNSUPPORTED",
        "WhatsApp uses templates, not Messenger tags.",
      );
    if (age >= 24 * 3600000)
      return result(
        false,
        "WHATSAPP_TEMPLATE_REQUIRED",
        "Outside 24 hours: use an approved template in ManyChat's interface. This API cannot send WhatsApp templates; no send was attempted.",
      );
    return result(true, "ALLOWED", "Inside the WhatsApp 24-hour window.");
  }
  if (tag === "HUMAN_AGENT") {
    if (!intent.human_agent || age >= 168 * 3600000)
      return result(
        false,
        "HUMAN_AGENT_REQUIRED",
        "HUMAN_AGENT requires a person and an interaction less than seven days ago. Automated sends are forbidden.",
      );
    return result(true, "HUMAN_AGENT", "Human support only.", [
      "Requires a human operator, App Review and business verification. Do not automate HUMAN_AGENT replies.",
    ]);
  }
  if (age < 24 * 3600000)
    return result(true, "ALLOWED", "Inside the standard 24-hour window.");
  const ad = evidence.adReferral;
  const first = ad ? Date.parse(ad.firstUserMessageAt) : NaN;
  const matchesChannel =
    (evidence.channel === "messenger" &&
      ad?.entryPoint === "click-to-messenger") ||
    (evidence.channel === "instagram" && ad?.entryPoint === "click-to-direct");
  if (
    ad?.verified === true &&
    matchesChannel &&
    Number.isFinite(first) &&
    first <= last &&
    now - first < 168 * 3600000
  )
    return result(
      true,
      "VERIFIED_AD_WINDOW",
      "Verified ad-origin conversation, inside seven days of its first user message.",
    );
  return result(
    false,
    "OUTSIDE_WINDOW",
    "Outside 24 hours. The ad-origin extension requires verified server-side referral evidence; caller declarations do not qualify.",
  );
}
