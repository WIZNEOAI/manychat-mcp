import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createAuthorizationCode, exchangeCodeForToken, refreshAccessToken, registerClient, resolveApiKeyFromToken, revokeToken, setOAuthStoreForTesting } from "../src/auth/oauth.js";
import { MemoryOAuthStore, createOAuthStoreFromEnv, assertDurableOAuthStoreConfig } from "../src/auth/oauth-store.js";
const redirectUri = "https://agent.example/callback";
const verifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-";
const challenge = createHash("sha256").update(verifier).digest("base64url");
describe("OAuth code and token flow", () => {
 let store: MemoryOAuthStore;
 afterEach(() => store?.close());
 it("issues and rotates tokens once, binds PKCE/client/redirect, and revokes access", async () => {
  store = new MemoryOAuthStore(); setOAuthStoreForTesting(store);
  const client = await registerClient("test", [redirectUri]);
  const wrongCode = await createAuthorizationCode(client.clientId, challenge, "S256", redirectUri, "offline-example-key");
  expect(await exchangeCodeForToken(wrongCode, client.clientId, verifier, "https://wrong.example/callback")).toBeNull();
  const code = await createAuthorizationCode(client.clientId, challenge, "S256", redirectUri, "offline-example-key");
  expect(await exchangeCodeForToken(code, client.clientId, "wrong-verifier-0123456789012345678901234567890123456", redirectUri)).toBeNull();
  const validCode = await createAuthorizationCode(client.clientId, challenge, "S256", redirectUri, "offline-example-key");
  const tokens = await exchangeCodeForToken(validCode, client.clientId, verifier, redirectUri);
  expect(tokens?.token_type).toBe("Bearer"); expect(await resolveApiKeyFromToken(tokens!.access_token)).toBe("offline-example-key");
  const rotated = await refreshAccessToken(tokens!.refresh_token, client.clientId); expect(rotated).not.toBeNull();
  expect(await refreshAccessToken(tokens!.refresh_token, client.clientId)).toBeNull();
  expect(await revokeToken(rotated!.access_token, "access_token")).toBe(true);
  expect(await resolveApiKeyFromToken(rotated!.access_token)).toBeNull();
 });
 it("requires Redis for production OAuth and durable HTTP configuration", () => {
  expect(() => createOAuthStoreFromEnv({ NODE_ENV: "production", OAUTH_STORE: "memory" } as NodeJS.ProcessEnv)).toThrow();
  expect(() => assertDurableOAuthStoreConfig({ OAUTH_STORE: "memory" } as NodeJS.ProcessEnv)).toThrow();
  expect(() => assertDurableOAuthStoreConfig({ OAUTH_STORE: "redis" } as NodeJS.ProcessEnv)).toThrow();
 });
});
