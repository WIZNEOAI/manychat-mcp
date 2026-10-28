import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { createOAuthRouter } from "../src/auth/oauth-routes.js";
import { setOAuthStoreForTesting } from "../src/auth/oauth.js";
import { MemoryOAuthStore } from "../src/auth/oauth-store.js";
describe("OAuth route input and redirect boundaries", () => {
 it("rejects non-TLS public redirect targets before client registration", async () => {
  const store = new MemoryOAuthStore(); setOAuthStoreForTesting(store); const app = express(); app.use(express.json()); app.use(createOAuthRouter("https://mcp.example"));
  const response = await request(app).post("/register").send({ client_name: "x", redirect_uris: ["http://attacker.example/callback"] });
  expect(response.status).toBe(400); expect(response.body.error).toBe("invalid_client_metadata"); store.close();
 });
 it("does not reflect malformed authorize inputs into redirects", async () => {
  const store = new MemoryOAuthStore(); setOAuthStoreForTesting(store); const app = express(); app.use(express.json()); app.use(createOAuthRouter("https://mcp.example"));
  const response = await request(app).post("/authorize").send({ client_id: "unknown", redirect_uri: "https://evil.example/", code_challenge: "x", code_challenge_method: "plain", state: "secret-state", api_key: "not-real-key" });
  expect(response.status).toBe(400); expect(response.headers.location).toBeUndefined(); expect(JSON.stringify(response.body)).not.toContain("secret-state"); store.close();
 });
 it("requires a secure issuer except loopback development", () => {
  expect(() => createOAuthRouter("http://mcp.example")).toThrow(); expect(() => createOAuthRouter("http://localhost:3000")).not.toThrow();
 });
});
