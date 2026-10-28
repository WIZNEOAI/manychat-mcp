import { beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { exchangeCodeForToken, refreshAccessToken, createAuthorizationCode, registerClient, setOAuthStoreForTesting } from "../src/auth/oauth.js";
import { MemoryOAuthStore, RedisOAuthStore, type OAuthStore } from "../src/auth/oauth-store.js";
const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-";
const challenge = createHash("sha256").update(verifier).digest("base64url");
const redirect = "https://client.example/callback";
interface MockPipeline { lpush(...args: string[]): MockPipeline; ltrim(...args: (string | number)[]): MockPipeline; exec(): Promise<unknown[]> }
class AtomicRedisMock {
  values = new Map<string, string>();
  async set(key: string, value: string): Promise<"OK"> { this.values.set(key, value); return "OK"; }
  async get(key: string): Promise<string | null> { return this.values.get(key) ?? null; }
  async del(key: string): Promise<number> { return this.values.delete(key) ? 1 : 0; }
  async call(command: string, key: string): Promise<string | null> { if (command !== "GETDEL") throw new Error("unexpected command"); const value = this.values.get(key) ?? null; if (value !== null) this.values.delete(key); return value; }
  multi(): MockPipeline { const pipeline: MockPipeline = { lpush: () => pipeline, ltrim: () => pipeline, exec: async () => [] }; return pipeline; }
}
async function prepare(store: OAuthStore) {
  setOAuthStoreForTesting(store);
  const client = await registerClient("offline test", [redirect]);
  const code = await createAuthorizationCode(client.clientId, challenge, "S256", redirect, "not-a-real-api-key");
  return { clientId: client.clientId, code };
}
const hundred = <T>(fn: () => Promise<T>): Promise<T[]> => Promise.all(Array.from({ length: 100 }, fn));
describe("OAuth redemption is single-use under concurrency", () => {
  let memory: MemoryOAuthStore;
  beforeEach(() => { memory = new MemoryOAuthStore(); setOAuthStoreForTesting(memory); });
  it("allows exactly one of 100 concurrent memory authorization-code redemptions", async () => {
    const { clientId, code } = await prepare(memory);
    const results = await hundred(() => exchangeCodeForToken(code, clientId, verifier, redirect));
    expect(results.filter(Boolean)).toHaveLength(1); memory.close();
  });
  it("allows exactly one of 100 concurrent memory refresh-token redemptions", async () => {
    const { clientId, code } = await prepare(memory);
    const initial = await exchangeCodeForToken(code, clientId, verifier, redirect); expect(initial).not.toBeNull();
    const results = await hundred(() => refreshAccessToken(initial!.refresh_token, clientId));
    expect(results.filter(Boolean)).toHaveLength(1); memory.close();
  });
  it("uses atomic Redis GETDEL from public code and refresh redemption paths", async () => {
    const redis = new AtomicRedisMock(); const store = new RedisOAuthStore("redis://offline.invalid", "test", redis as never);
    const { clientId, code } = await prepare(store);
    const codes = await hundred(() => exchangeCodeForToken(code, clientId, verifier, redirect));
    expect(codes.filter(Boolean)).toHaveLength(1);
    const issued = codes.find(Boolean)!;
    const refreshes = await hundred(() => refreshAccessToken(issued.refresh_token, clientId));
    expect(refreshes.filter(Boolean)).toHaveLength(1);
    expect([...redis.values.keys()].some((key) => key.includes(issued.refresh_token))).toBe(false);
  });
  it("store-level memory take consumes an authorization code once", async () => {
    const { code } = await prepare(memory); const results = await hundred(() => memory.takeAuthorizationCode(code));
    expect(results.filter(Boolean)).toHaveLength(1); memory.close();
  });
});
