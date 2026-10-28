import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RedisOAuthStore,
  assertDurableOAuthStoreConfig,
} from "../src/auth/oauth-store.js";

class StorageIO {
  readonly values = new Map<string, string>();
  async set(key: string, value: string): Promise<"OK"> {
    this.values.set(key, value);
    return "OK";
  }
  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }
  async call(command: string, key: string): Promise<string | null> {
    if (command !== "GETDEL")
      throw new Error("Only credential storage I/O is mocked here.");
    const value = await this.get(key);
    this.values.delete(key);
    return value;
  }
}
const encryptionKey = "12".repeat(32); // Offline fixture, never a deployment key.
const apiKey = "offline-api-key-ciphertext-canary";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const record = (token: string) => ({
  token,
  clientId: "offline-client",
  apiKey,
  createdAt: Date.now(),
  expiresAt: Date.now() + 60000,
  revokedAt: null,
});
const makeStore = (io: StorageIO, key = encryptionKey) =>
  new RedisOAuthStore("redis://offline.invalid", "offline", io as never, key);

describe("Redis OAuth credential storage boundary (mocked I/O, real cryptography)", () => {
  it("encrypts every credential record and hashes every credential key while preserving redemption", async () => {
    const io = new StorageIO();
    const store = makeStore(io);
    const code = {
      code: "offline-code-canary",
      clientId: "offline-client",
      codeChallenge: "a".repeat(43),
      codeChallengeMethod: "S256" as const,
      redirectUri: "https://client.example/callback",
      apiKey,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60000,
    };
    const access = record("offline-access-canary");
    const refresh = record("offline-refresh-canary");
    await store.saveAuthorizationCode(code);
    await store.saveAccessToken(access);
    await store.saveRefreshToken(refresh);
    expect([...io.values.keys()].sort()).toEqual(
      [
        `offline:auth_code:${hash(code.code)}`,
        `offline:access_token:${hash(access.token)}`,
        `offline:refresh_token:${hash(refresh.token)}`,
      ].sort(),
    );
    const persisted = JSON.stringify([...io.values]);
    for (const secret of [apiKey, code.code, access.token, refresh.token])
      expect(persisted).not.toContain(secret);
    expect(
      [...io.values.values()].every((value) => value.startsWith("enc:v1:")),
    ).toBe(true);
    expect(await store.takeAuthorizationCode(code.code)).toEqual(code);
    expect(await store.takeAuthorizationCode(code.code)).toBeNull();
    expect(await store.getAccessToken(access.token)).toEqual(access);
    expect(await store.takeRefreshToken(refresh.token)).toEqual(refresh);
    expect(await store.takeRefreshToken(refresh.token)).toBeNull();
    expect(await store.revokeAccessToken(access.token)).toBe(true);
    expect(await store.getAccessToken(access.token)).toBeNull();
    expect(JSON.stringify([...io.values])).not.toContain(apiKey);
  });
  it("uses fresh nonces and rejects modified, swapped, plaintext and wrong-key records", async () => {
    const io = new StorageIO();
    const store = makeStore(io);
    const first = record("first-token");
    const second = record("second-token");
    const firstKey = `offline:access_token:${hash(first.token)}`;
    const secondKey = `offline:access_token:${hash(second.token)}`;
    await store.saveAccessToken(first);
    const initial = io.values.get(firstKey)!;
    await store.saveAccessToken(first);
    expect(io.values.get(firstKey)).not.toBe(initial);
    await store.saveAccessToken(second);
    io.values.set(firstKey, io.values.get(secondKey)!);
    await expect(store.getAccessToken(first.token)).rejects.toThrow(
      "OAuth store data is invalid.",
    );
    io.values.set(firstKey, initial);
    await expect(
      makeStore(io, "34".repeat(32)).getAccessToken(first.token),
    ).rejects.toThrow("OAuth store data is invalid.");
    const payload = Buffer.from(initial.slice("enc:v1:".length), "base64url");
    payload[payload.length - 1] ^= 1;
    io.values.set(firstKey, "enc:v1:" + payload.toString("base64url"));
    await expect(store.getAccessToken(first.token)).rejects.toThrow(
      "OAuth store data is invalid.",
    );
    io.values.set(firstKey, JSON.stringify(first));
    await expect(store.getAccessToken(first.token)).rejects.toThrow(
      "OAuth store data is invalid.",
    );
  });
  it.each([undefined, "", "not-a-key", "12".repeat(31), "xx".repeat(32)])(
    "rejects missing or invalid encryption config before opening Redis: %s",
    (key) => {
      expect(
        () =>
          new RedisOAuthStore(
            "redis://offline.invalid",
            "offline",
            new StorageIO() as never,
            key ?? "",
          ),
      ).toThrow("OAUTH_ENC_KEY");
      expect(() =>
        assertDurableOAuthStoreConfig({
          OAUTH_STORE: "redis",
          REDIS_URL: "redis://offline.invalid",
          OAUTH_ENC_KEY: key,
        }),
      ).toThrow("OAUTH_ENC_KEY");
    },
  );
});
