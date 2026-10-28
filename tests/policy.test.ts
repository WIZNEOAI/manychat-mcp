import { describe, expect, it } from "vitest";
import {
  evaluatePolicy,
  type Channel,
  type InteractionEvidence,
  type MessageIntent,
} from "../src/policy/guard.js";
const now = Date.parse("2026-10-28T12:00:00Z");
const evidence = (channel: Channel, hours: number): InteractionEvidence => ({
  subscriberId: 1,
  channel,
  source: "verified-webhook",
  lastUserInteractionAt: new Date(now - hours * 3600000).toISOString(),
});
describe("Meta policy from trusted evidence", () => {
  it.each(["whatsapp", "messenger", "instagram"] as const)(
    "%s allows recent interactions and blocks expired standard windows",
    (channel) => {
      expect(evaluatePolicy(evidence(channel, 1), {}, now).allowed).toBe(true);
      expect(evaluatePolicy(evidence(channel, 25), {}, now).allowed).toBe(
        false,
      );
    },
  );
  it.each(["CONFIRMED_EVENT_UPDATE", "POST_PURCHASE_UPDATE", "ACCOUNT_UPDATE"])(
    "blocks deprecated %s even inside window",
    (tag) => {
      expect(
        evaluatePolicy(
          evidence("messenger", 1),
          { message_tag: tag, promotional: false },
          now,
        ),
      ).toMatchObject({ allowed: false, code: "TAG_DEPRECATED" });
    },
  );
  it("requires a human and warns about App Review, forbids automation and promotions", () => {
    const e = evidence("instagram", 48);
    expect(
      evaluatePolicy(e, { message_tag: "HUMAN_AGENT", promotional: false }, now)
        .allowed,
    ).toBe(false);
    const human: MessageIntent = {
      message_tag: "HUMAN_AGENT",
      promotional: false,
    };
    expect(
      evaluatePolicy(e, human, now, { allowHumanAgent: true }).allowed,
    ).toBe(true);
    expect(
      evaluatePolicy(e, human, now, { allowHumanAgent: true }).warnings.join(
        " ",
      ),
    ).toMatch(/App Review/);
    expect(
      evaluatePolicy(evidence("instagram", 169), human, now, {
        allowHumanAgent: true,
      }).allowed,
    ).toBe(false);
    expect(
      evaluatePolicy(e, { ...human, promotional: true }, now, {
        allowHumanAgent: true,
      }).allowed,
    ).toBe(false);
    expect(
      evaluatePolicy(evidence("whatsapp", 25), human, now, {
        allowHumanAgent: true,
      }).allowed,
    ).toBe(false);
  });
  it.each(["sms", "email", "telegram"] as const)(
    "%s is outside Meta wedge, without claiming send support",
    (channel) => {
      const verdict = evaluatePolicy(evidence(channel, 1000), {}, now);
      expect(verdict.allowed).toBe(true);
      expect(verdict.code).toBe("OUTSIDE_META_WEDGE");
    },
  );
  it("only extends an ad-origin window with verified matching-channel referral evidence", () => {
    const e = evidence("messenger", 48);
    expect(evaluatePolicy(e, {}, now).allowed).toBe(false);
    const ad = {
      ...e,
      adReferral: {
        entryPoint: "click-to-messenger" as const,
        firstUserMessageAt: e.lastUserInteractionAt,
        verified: true as const,
      },
    };
    expect(evaluatePolicy(ad, {}, now).allowed).toBe(true);
    expect(
      evaluatePolicy(
        {
          ...ad,
          adReferral: { ...ad.adReferral, entryPoint: "click-to-direct" },
        },
        {},
        now,
      ).allowed,
    ).toBe(false);
    expect(
      evaluatePolicy(
        { ...ad, adReferral: { ...ad.adReferral, verified: false as true } },
        {},
        now,
      ).allowed,
    ).toBe(false);
    expect(
      evaluatePolicy(
        {
          ...ad,
          adReferral: {
            ...ad.adReferral,
            firstUserMessageAt: new Date(now - 169 * 3600000).toISOString(),
          },
        },
        {},
        now,
      ).allowed,
    ).toBe(false);
  });
  it("rejects unknown tags, unsupported TikTok and invalid or future timestamps", () => {
    expect(
      evaluatePolicy(evidence("messenger", 1), { message_tag: "BYPASS" }, now)
        .allowed,
    ).toBe(false);
    expect(evaluatePolicy(evidence("tiktok", 1), {}, now).allowed).toBe(false);
    expect(evaluatePolicy(evidence("messenger", -1), {}, now).allowed).toBe(
      false,
    );
    expect(
      evaluatePolicy(
        { ...evidence("messenger", 1), lastUserInteractionAt: "bad" },
        {},
        now,
      ).allowed,
    ).toBe(false);
  });
});
