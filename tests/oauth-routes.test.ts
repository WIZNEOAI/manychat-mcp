import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createOAuthRouter } from "../src/auth/oauth-routes.js";
import { setOAuthStoreForTesting } from "../src/auth/oauth.js";
import { MemoryOAuthStore } from "../src/auth/oauth-store.js";
describe("OAuth route input and redirect boundaries", () => {
  it("rejects non-TLS public redirect targets before client registration", async () => {
    const store = new MemoryOAuthStore();
    setOAuthStoreForTesting(store);
    const app = express();
    app.use(express.json());
    app.use(createOAuthRouter("https://mcp.example"));
    const response = await request(app)
      .post("/register")
      .send({
        client_name: "x",
        redirect_uris: ["http://attacker.example/callback"],
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("invalid_client_metadata");
    store.close();
  });
  it("does not reflect malformed authorize inputs into redirects", async () => {
    const store = new MemoryOAuthStore();
    setOAuthStoreForTesting(store);
    const app = express();
    app.use(express.json());
    app.use(createOAuthRouter("https://mcp.example"));
    const response = await request(app).post("/authorize").send({
      client_id: "unknown",
      redirect_uri: "https://evil.example/",
      code_challenge: "x",
      code_challenge_method: "plain",
      state: "secret-state",
      api_key: "not-real-key",
    });
    expect(response.status).toBe(400);
    expect(response.headers.location).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain("secret-state");
    store.close();
  });
  it("preserves opaque client state exactly through the authorization callback", async () => {
    const store = new MemoryOAuthStore();
    setOAuthStoreForTesting(store);
    try {
      const app = express();
      app.use(express.json());
      app.use(createOAuthRouter("https://mcp.example"));
      const registration = await request(app)
        .post("/register")
        .send({
          client_name: "Offline client",
          redirect_uris: ["https://client.example/callback"],
        });
      const state = 'opaque<&"+%/state';
      const params = {
        client_id: registration.body.client_id,
        redirect_uri: "https://client.example/callback",
        response_type: "code",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
        state,
      };
      const page = await request(app).get("/authorize").query(params);
      expect(page.status).toBe(200);
      expect(page.text).toContain("opaque&lt;&amp;&quot;+%/state");
      const response = await request(app)
        .post("/authorize")
        .send({ ...params, api_key: "offline-not-a-real-key" });
      expect(response.status).toBe(302);
      const callback = new URL(response.headers.location);
      expect(callback.origin + callback.pathname).toBe(
        "https://client.example/callback",
      );
      expect(callback.searchParams.get("state")).toBe(state);
      expect(callback.searchParams.get("code")).toMatch(/^[a-f0-9]{64}$/);
      expect(response.headers.location).not.toContain("offline-not-a-real-key");
    } finally {
      store.close();
    }
  });
  it("requires a secure issuer except loopback development", () => {
    expect(() => createOAuthRouter("http://mcp.example")).toThrow();
    expect(() => createOAuthRouter("http://localhost:3000")).not.toThrow();
  });
});
