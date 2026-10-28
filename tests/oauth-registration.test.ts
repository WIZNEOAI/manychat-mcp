import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClientRegistrationLimitError,
  MemoryClientRegistry,
} from "../src/auth/client-registry.js";

describe("MemoryClientRegistry resource controls", () => {
  afterEach(() => vi.useRealTimers());

  it("enforces the global cap across concurrent registrations and frees expired leases", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const registry = new MemoryClientRegistry({
      maxClients: 2,
      unusedTtlMs: 100,
    });
    const results = await Promise.allSettled([
      registry.register("one", ["https://one.example/cb"]),
      registry.register("two", ["https://two.example/cb"]),
      registry.register("three", ["https://three.example/cb"]),
    ]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(
      2,
    );
    expect(
      results.filter(
        (item) =>
          item.status === "rejected" &&
          item.reason instanceof ClientRegistrationLimitError,
      ),
    ).toHaveLength(1);
    vi.advanceTimersByTime(101);
    await expect(
      registry.register("replacement", ["https://new.example/cb"]),
    ).resolves.toMatchObject({ clientName: "replacement" });
  });

  it("limits each hashed IP to a fixed window and expires the bounded quota entry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const registry = new MemoryClientRegistry({ ipLimit: 2, ipWindowMs: 100 });
    expect(await registry.takeQuota("203.0.113.4")).toBe(true);
    expect(await registry.takeQuota("203.0.113.4")).toBe(true);
    expect(await registry.takeQuota("203.0.113.4")).toBe(false);
    expect(await registry.takeQuota("203.0.113.5")).toBe(true);
    vi.advanceTimersByTime(101);
    expect(await registry.takeQuota("203.0.113.4")).toBe(true);
  });

  it("bounds distinct-IP registration attempts globally and retains used client leases separately", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const registry = new MemoryClientRegistry({
      unusedTtlMs: 100,
      activeTtlMs: 1000,
      maxRegistrationAttempts: 2,
    });
    const attempts = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        registry.takeQuota(`203.0.113.${i}`),
      ),
    );
    expect(attempts.filter(Boolean)).toHaveLength(2);
    const used = await registry.register("used", ["https://example.test/cb"]);
    const unused = await registry.register("unused", [
      "https://example.test/cb",
    ]);
    expect(await registry.markUsed(used.clientId)).toBe(true);
    vi.advanceTimersByTime(101);
    expect(await registry.get(unused.clientId)).toBeNull();
    expect(await registry.get(used.clientId)).not.toBeNull();
    expect(await registry.markUsed(unused.clientId)).toBe(false);
    vi.advanceTimersByTime(900);
    expect(await registry.get(used.clientId)).toBeNull();
  });
  it("returns defensive copies and does not renew a client lease on reads", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const registry = new MemoryClientRegistry({ unusedTtlMs: 100 });
    const client = await registry.register("unverified", [
      "https://example.test/cb",
    ]);
    const fetched = await registry.get(client.clientId);
    fetched!.redirectUris.push("https://attacker.test/");
    expect((await registry.get(client.clientId))?.redirectUris).toEqual([
      "https://example.test/cb",
    ]);
    vi.advanceTimersByTime(101);
    expect(await registry.get(client.clientId)).toBeNull();
  });
});
