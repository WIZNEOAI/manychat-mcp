import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createHttpApp } from "../src/mcp/http.js";
import { MemoryRateStore } from "../src/mcp/rate-limit.js";
const headers = {
  "x-manychat-api-key": "offline-test-credential",
  accept: "application/json, text/event-stream",
  "MCP-Protocol-Version": "2026-07-28",
};
const rpc = (method: string, params = {}) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  params: {
    ...params,
    _meta: {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": {},
    },
  },
});
function parse(response: { text: string }) {
  const frame = response.text.split("\n").find((l) => l.startsWith("data: "));
  return JSON.parse(frame ? frame.slice(6) : response.text);
}
describe("HTTP gateway boundaries", () => {
  it("health discloses no auth/version/internal configuration and unknown routes are 404", async () => {
    const { app } = createHttpApp({ env: {} });
    expect((await request(app).get("/health")).body).toEqual({ status: "ok" });
    expect((await request(app).get("/unknown")).status).toBe(404);
  });
  it("rejects missing credentials even if a server environment key exists", async () => {
    const { app } = createHttpApp({
      env: { MANYCHAT_API_KEY: "server-key-not-for-visitors" },
    });
    expect(
      (await request(app).post("/mcp").send(rpc("tools/list"))).status,
    ).toBe(401);
  });
  it("rejects unsupported methods, oversize bodies, malformed JSON and hostile origins", async () => {
    const { app } = createHttpApp({ env: {} });
    for (const method of ["get", "delete"] as const)
      expect((await request(app)[method]("/mcp")).status).toBe(405);
    expect(
      (
        await request(app)
          .post("/mcp")
          .set(headers)
          .send({ x: "x".repeat(32768) })
      ).status,
    ).toBe(413);
    const malformed = await request(app)
      .post("/mcp")
      .set(headers)
      .set("Content-Type", "application/json")
      .send('{"x":"secret-echo-canary"');
    expect(malformed.status).toBe(400);
    expect(malformed.text).not.toContain("secret-echo-canary");
    expect(
      (
        await request(app)
          .post("/mcp")
          .set({ ...headers, Origin: "https://evil.example" })
          .send(rpc("tools/list"))
      ).status,
    ).toBe(403);
  });
  it("enforces IP and credential budgets independently and fails closed on store failure", async () => {
    const ip = createHttpApp({ env: {}, ipLimit: 1, keyLimit: 100 }).app;
    expect((await request(ip).get("/unknown")).status).toBe(404);
    expect((await request(ip).get("/unknown")).status).toBe(429);
    expect((await request(ip).get("/health")).status).toBe(200);
    const key = createHttpApp({ env: {}, ipLimit: 100, keyLimit: 1 }).app;
    expect(
      (
        await request(key)
          .post("/mcp")
          .set({ ...headers, "Mcp-Method": "tools/list" })
          .send(rpc("tools/list"))
      ).status,
    ).toBe(200);
    expect(
      (await request(key).post("/mcp").set(headers).send(rpc("tools/list")))
        .status,
    ).toBe(429);
    const broken = createHttpApp({
      env: {},
      rateStore: {
        take: async () => {
          throw new Error("private-store-details");
        },
        close: async () => {},
      },
    }).app;
    expect((await request(broken).get("/health")).status).toBe(200);
    const r = await request(broken).get("/unknown");
    expect(r.status).toBe(503);
    expect(r.text).not.toContain("private-store-details");
  });
  it("allows OAuth's own form origin but rejects cross-origin credential submission", async () => {
    const { app } = createHttpApp({
      env: { MCP_REMOTE_AUTH: "oauth", MCP_BASE_URL: "https://mcp.example" },
    });
    const own = await request(app)
      .post("/authorize")
      .set("Origin", "https://mcp.example")
      .send({});
    expect(own.status).toBe(400);
    expect(own.body).toEqual({ error: "invalid_request" });
    expect(
      (
        await request(app)
          .post("/authorize")
          .set("Origin", "https://evil.example")
          .send({})
      ).status,
    ).toBe(403);
  });
  it("does not accept X-ManyChat-API-Key to bypass OAuth", async () => {
    const { app } = createHttpApp({ env: { MCP_REMOTE_AUTH: "oauth" } });
    expect(
      (await request(app).post("/mcp").set(headers).send(rpc("tools/list")))
        .status,
    ).toBe(401);
  });
  it("requires shared counters in production and never trusts arbitrary forwarded IPs", async () => {
    expect(() => createHttpApp({ env: { NODE_ENV: "production" } })).toThrow(
      "REDIS_URL",
    );
    const { app } = createHttpApp({ env: {}, ipLimit: 1 });
    expect(
      (
        await request(app)
          .get("/unknown")
          .set("X-Forwarded-For", "198.51.100.1")
      ).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get("/unknown")
          .set("X-Forwarded-For", "198.51.100.2")
      ).status,
    ).toBe(429);
  });
  it.each([{ TRUST_PROXY_HOPS: "1" }, { TRUST_PROXY_CIDRS: "loopback" }])(
    "separates clients behind the configured proxy without trusting a spoofed earlier hop: %j",
    async (proxy) => {
      const { app, close } = createHttpApp({
        env: {
          NODE_ENV: "production",
          REDIS_URL: "redis://offline.invalid",
          ...proxy,
        },
        rateStore: new MemoryRateStore(),
        ipLimit: 1,
      });
      try {
        expect(
          (
            await request(app)
              .get("/unknown")
              .set("X-Forwarded-For", "198.51.100.99, 203.0.113.1")
          ).status,
        ).toBe(404);
        expect(
          (
            await request(app)
              .get("/unknown")
              .set("X-Forwarded-For", "198.51.100.98, 203.0.113.1")
          ).status,
        ).toBe(429);
        expect(
          (
            await request(app)
              .get("/unknown")
              .set("X-Forwarded-For", "203.0.113.2")
          ).status,
        ).toBe(404);
        expect(
          (
            await request(app)
              .get("/health")
              .set("X-Forwarded-For", "203.0.113.1")
          ).status,
        ).toBe(200);
      } finally {
        await close();
      }
    },
  );
  it.each([
    {},
    { TRUST_PROXY_CIDRS: "  ,  " },
    { TRUST_PROXY_HOPS: "0" },
    { TRUST_PROXY_HOPS: "1.5" },
    { TRUST_PROXY_HOPS: "1e1" },
    { TRUST_PROXY_HOPS: "17" },
    { TRUST_PROXY_HOPS: "1", TRUST_PROXY_CIDRS: "loopback" },
  ])(
    "rejects absent or ambiguous production proxy configuration: %j",
    (proxy) => {
      expect(() =>
        createHttpApp({
          env: {
            NODE_ENV: "production",
            REDIS_URL: "redis://offline.invalid",
            ...proxy,
          },
          rateStore: new MemoryRateStore(),
        }),
      ).toThrow(/TRUST_PROXY/);
    },
  );
  it("applies browser security headers to health, unknown routes and credential errors", async () => {
    const { app, close } = createHttpApp({ env: {} });
    try {
      const responses = [
        await request(app).get("/health"),
        await request(app).get("/unknown"),
        await request(app).post("/mcp").send(rpc("tools/list")),
      ];
      expect(responses.map((response) => response.status)).toEqual([
        200, 404, 401,
      ]);
      for (const response of responses) {
        expect(response.headers["content-security-policy"]).toBe(
          "frame-ancestors 'none'; default-src 'none'; style-src 'unsafe-inline'",
        );
        expect(response.headers["x-frame-options"]).toBe("DENY");
        expect(response.headers["strict-transport-security"]).toBe(
          "max-age=31536000",
        );
      }
    } finally {
      await close();
    }
  });
  it("is stateless across independent app instances and shares rate budgets when configured", async () => {
    const rate = new MemoryRateStore();
    const apps = Array.from(
      { length: 3 },
      () => createHttpApp({ env: {}, rateStore: rate, keyLimit: 3 }).app,
    );
    for (let i = 0; i < 3; i++) {
      const method = i === 0 ? "server/discover" : "tools/list";
      const r = await request(apps[i])
        .post("/mcp")
        .set({ ...headers, "Mcp-Method": method })
        .send(rpc(method));
      expect(r.status).toBe(200);
      expect(r.headers["mcp-session-id"]).toBeUndefined();
      const body = parse(r);
      expect(body.error).toBeUndefined();
      if (i === 0)
        expect(body.result.supportedVersions).toContain("2026-07-28");
      else expect(body.result.tools).toHaveLength(28);
    }
    expect(
      (await request(apps[0]).post("/mcp").set(headers).send(rpc("tools/list")))
        .status,
    ).toBe(429);
  });
  it.each(["send_text_message", "send_content", "send_flow"])(
    "MCP %s reaches the same guard and never sends with ambiguous evidence",
    async (name) => {
      const upstream = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "success",
            data: {
              id: "7",
              last_interaction: new Date().toISOString(),
              ig_id: 99,
              whatsapp_phone: "+15550000000",
            },
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", upstream);
      const args =
        name === "send_flow"
          ? { subscriber_id: 7, flow_ns: "flow:test" }
          : name === "send_content"
            ? {
                subscriber_id: 7,
                data: {
                  version: "v2",
                  content: { messages: [{ type: "text", text: "hello" }] },
                },
              }
            : { subscriber_id: 7, text: "hello" };
      const { app } = createHttpApp({ env: {} });
      const r = await request(app)
        .post("/mcp")
        .set({ ...headers, "Mcp-Method": "tools/call", "Mcp-Name": name })
        .send(rpc("tools/call", { name, arguments: args }));
      const body = parse(r);
      expect(body.error).toBeUndefined();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toContain("CHANNEL_UNKNOWN");
      expect(upstream).toHaveBeenCalledOnce();
      expect(upstream.mock.calls[0][1].method).toBe("GET");
    },
  );
  it("keeps request credentials isolated between two calls", async () => {
    const upstream = vi.fn().mockImplementation(
      async (_url, options) =>
        new Response(
          JSON.stringify({
            status: "success",
            data: {
              credential:
                options.headers.Authorization === "Bearer credential-A"
                  ? "A"
                  : "B",
            },
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", upstream);
    const { app } = createHttpApp({ env: {} });
    const call = (credential: string) =>
      request(app)
        .post("/mcp")
        .set({
          ...headers,
          "x-manychat-api-key": credential,
          "Mcp-Method": "tools/call",
          "Mcp-Name": "get_page_info",
        })
        .send(rpc("tools/call", { name: "get_page_info", arguments: {} }));
    const results = await Promise.all([
      call("credential-A"),
      call("credential-B"),
    ]);
    expect(parse(results[0]).result.content[0].text).toContain('"A"');
    expect(parse(results[1]).result.content[0].text).toContain('"B"');
  });
});
