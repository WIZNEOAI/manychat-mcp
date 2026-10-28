import { describe, expect, it, vi } from "vitest";
import { ExecutionEngine, operations, PolicyError } from "../src/core/engine.js";
import { runCli } from "../src/cli/app.js";
import type { InteractionEvidence } from "../src/policy/guard.js";
function fixture(channel: InteractionEvidence["channel"] = "messenger", hours = 1) {
  const last = new Date(Date.now() - hours * 3600000).toISOString();
  const get = vi.fn().mockResolvedValue({ id: "7", last_interaction: last, ig_id: 9, whatsapp_phone: "+15550000000" });
  const post = vi.fn().mockResolvedValue({ sent: true });
  const proof: InteractionEvidence = { subscriberId: 7, channel, lastUserInteractionAt: last, source: "verified-webhook" };
  return { get, post, proof, api: { get, post }, resolve: vi.fn().mockResolvedValue(proof) };
}
const sends = [ ["send_text_message", { subscriber_id: 7, text: "hello" }], ["send_content", { subscriber_id: 7, data: { version: "v2", content: { messages: [{ type: "text", text: "hello" }] } } }], ["send_flow", { subscriber_id: 7, flow_ns: "flow:test" }] ] as const;
describe("shared execution boundary", () => {
  it.each(sends)("%s fails closed with the actual ambiguous ManyChat schema and never POSTs", async (name, args) => {
    const f = fixture(); const e = new ExecutionEngine(f.api);
    await expect(e.execute(name, args)).rejects.toThrow("CHANNEL_UNKNOWN");
    expect(f.get).toHaveBeenCalledWith("/subscriber/getInfo", { subscriber_id: "7" });
    expect(f.post).not.toHaveBeenCalled();
  });
  it.each(sends)("%s blocks an expired WhatsApp window even with an installed trusted provider", async (name, args) => {
    const f = fixture("whatsapp", 25); const e = new ExecutionEngine(f.api, { resolve: f.resolve });
    await expect(e.execute(name, args)).rejects.toBeInstanceOf(PolicyError);
    expect(f.post).not.toHaveBeenCalled();
  });
  it.each(sends)("%s permits a verified recent interaction and posts only after lookup", async (name, args) => {
    const f = fixture(); await new ExecutionEngine(f.api, { resolve: f.resolve }).execute(name, args);
    expect(f.post).toHaveBeenCalledOnce();
    expect(f.get.mock.invocationCallOrder[0]).toBeLessThan(f.post.mock.invocationCallOrder[0]);
  });
  it("refuses caller evidence, override flags and hidden content tags", async () => {
    const f = fixture(); const e = new ExecutionEngine(f.api);
    for (const extra of [{ channel: "messenger" }, { within_24h_window: true }, { override_policy: true }, { adReferral: { verified: true } }]) await expect(e.execute("send_text_message", { ...sends[0][1], ...extra })).rejects.toThrow();
    await expect(e.execute("send_content", { subscriber_id: 7, data: { version: "v2", content: { messages: [{ type: "text", text: "x" }], message_tag: "HUMAN_AGENT" } } })).rejects.toThrow();
    expect(f.get).not.toHaveBeenCalled(); expect(f.post).not.toHaveBeenCalled();
  });
  it("rejects missing, mismatched and failed evidence and rechecks each send", async () => {
    const f = fixture(); const e = new ExecutionEngine(f.api, { resolve: f.resolve });
    f.resolve.mockResolvedValueOnce({ ...f.proof, subscriberId: 8 });
    await expect(e.execute(...sends[0])).rejects.toThrow("CHANNEL_UNKNOWN");
    f.get.mockResolvedValueOnce({ id: "7", last_interaction: null });
    await expect(e.execute(...sends[0])).rejects.toThrow("INTERACTION_UNKNOWN");
    f.get.mockRejectedValueOnce(new Error("upstream unavailable"));
    await expect(e.execute(...sends[0])).rejects.toThrow("EVIDENCE_UNAVAILABLE");
    await e.execute(...sends[0]);
    f.get.mockResolvedValueOnce({ id: "8", last_interaction: f.proof.lastUserInteractionAt });
    await expect(e.execute(...sends[0])).rejects.toThrow("SUBSCRIBER_MISMATCH");
    expect(f.post).toHaveBeenCalledOnce();
  });
  it("validate_message loads real evidence and does not send", async () => {
    const f = fixture(); const verdict = await new ExecutionEngine(f.api).execute("validate_message", { subscriber_id: 7 });
    expect(verdict).toMatchObject({ allowed: false, code: "CHANNEL_UNKNOWN" }); expect(f.post).not.toHaveBeenCalled();
  });
  it.each(["text", "content", "flow"])("CLI send %s uses the shared guard", async mode => {
    const f = fixture(); const out = vi.fn(); const err = vi.fn();
    const payload = mode === "content" ? JSON.stringify(sends[1][1].data) : "hello";
    expect(await runCli(["send", mode, "7", payload], new ExecutionEngine(f.api), { out, err })).toBe(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining("CHANNEL_UNKNOWN")); expect(out).not.toHaveBeenCalled(); expect(f.post).not.toHaveBeenCalled();
  });
  it("CLI cannot raw-post around the guard and validates IDs", async () => {
    const f = fixture(); const io = { out: vi.fn(), err: vi.fn() };
    const e = new ExecutionEngine(f.api);
    expect(await runCli(["raw", "post", "/sending/sendContent"], e, io)).toBe(1);
    expect(await runCli(["subscribers", "get", "-1"], e, io)).toBe(1);
    expect(f.post).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled();
  });
  it("routes account reads and mutations with validated parameters", async () => {
    const f = fixture(); const e = new ExecutionEngine(f.api);
    await e.execute("find_subscriber_by_email", { email: "test@example.com" });
    expect(f.get).toHaveBeenLastCalledWith("/subscriber/findBySystemField", { email: "test@example.com" });
    await e.execute("add_tag_to_subscriber", { subscriber_id: 7, tag_id: 2 });
    expect(f.post).toHaveBeenLastCalledWith("/subscriber/addTag", { subscriber_id: 7, tag_id: 2 });
    await expect(e.execute("create_subscriber", {})).rejects.toThrow();
    await expect(e.execute("set_custom_fields_bulk", { subscriber_id: 7, fields: [{ field_value: "x" }] })).rejects.toThrow();
    expect(Object.keys(operations)).toHaveLength(28);
  });
});
