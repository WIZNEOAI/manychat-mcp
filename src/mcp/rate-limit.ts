import { createHash } from "node:crypto";
import { Redis } from "ioredis";
export interface RateStore { take(key: string, limit: number): Promise<boolean>; close(): Promise<void> }
export class MemoryRateStore implements RateStore {
  private readonly buckets = new Map<string, { count: number; expires: number }>();
  async take(key: string, limit: number): Promise<boolean> {
    const now = Date.now();
    if (this.buckets.size >= 10000) {
      for (const [k, v] of this.buckets) if (v.expires <= now) this.buckets.delete(k);
      if (this.buckets.size >= 10000 && !this.buckets.has(key)) return false;
    }
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.expires <= now) { this.buckets.set(key, { count: 1, expires: now + 60000 }); return true; }
    return ++bucket.count <= limit;
  }
  async close(): Promise<void> { this.buckets.clear(); }
}
/** Atomic distributed fixed window. Only credential digests enter the store. */
export class RedisRateStore implements RateStore {
  private readonly redis: Redis;
  constructor(url: string) { this.redis = new Redis(url, { maxRetriesPerRequest: 1, connectTimeout: 3000, enableOfflineQueue: false }); this.redis.on("error", () => {}); }
  async take(key: string, limit: number): Promise<boolean> {
    const script = "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], 60000) end; return n";
    const count = await this.redis.eval(script, 1, `manychat:rate:${key}`);
    return Number(count) <= limit;
  }
  async close(): Promise<void> { this.redis.disconnect(); }
}
export const credentialHash = (key: string): string => createHash("sha256").update(key).digest("hex");
