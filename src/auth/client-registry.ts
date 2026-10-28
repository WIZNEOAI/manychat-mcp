import { createHash, randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { RegisteredClient } from "./oauth-store.js";

export interface ClientRegistryConfig {
  maxClients?: number;
  unusedTtlMs?: number;
  activeTtlMs?: number;
  ipLimit?: number;
  ipWindowMs?: number;
  maxRegistrationAttempts?: number;
}
export class ClientRegistrationLimitError extends Error {
  constructor() {
    super("OAuth client registration capacity reached.");
    this.name = "ClientRegistrationLimitError";
  }
}
export interface ClientRegistry {
  register(name: string, redirectUris: string[]): Promise<RegisteredClient>;
  get(id: string): Promise<RegisteredClient | null>;
  markUsed(id: string): Promise<boolean>;
  takeQuota(ip: string): Promise<boolean>;
}
const defaults = {
  maxClients: 1000,
  unusedTtlMs: 86_400_000,
  activeTtlMs: 2_592_000_000,
  ipLimit: 5,
  ipWindowMs: 3_600_000,
  maxRegistrationAttempts: 1000,
};
function config(value: ClientRegistryConfig = {}) {
  const result = { ...defaults, ...value };
  for (const [key, n] of Object.entries(result))
    if (!Number.isSafeInteger(n) || n <= 0)
      throw new Error(`${key} must be a positive integer.`);
  return result;
}
function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
type Budget = { count: number; expiresAt: number };
function copy(client: RegisteredClient): RegisteredClient {
  return { ...client, redirectUris: [...client.redirectUris] };
}
export class MemoryClientRegistry implements ClientRegistry {
  private readonly clients = new Map<
    string,
    { client: RegisteredClient; expiresAt: number }
  >();
  private readonly quotas = new Map<string, Budget>();
  private globalQuota: Budget | null = null;
  private readonly options: ReturnType<typeof config>;
  constructor(options: ClientRegistryConfig = {}) {
    this.options = config(options);
  }
  async register(
    name: string,
    redirectUris: string[],
  ): Promise<RegisteredClient> {
    const now = Date.now();
    for (const [id, record] of this.clients)
      if (record.expiresAt <= now) this.clients.delete(id);
    if (this.clients.size >= this.options.maxClients)
      throw new ClientRegistrationLimitError();
    const client = {
      clientId: randomUUID(),
      clientName: name,
      redirectUris: [...redirectUris],
      createdAt: now,
    };
    this.clients.set(client.clientId, {
      client,
      expiresAt: now + this.options.unusedTtlMs,
    });
    return copy(client);
  }
  async get(id: string): Promise<RegisteredClient | null> {
    const record = this.clients.get(id);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      this.clients.delete(id);
      return null;
    }
    return copy(record.client);
  }
  async markUsed(id: string): Promise<boolean> {
    const record = this.clients.get(id);
    if (!record || record.expiresAt <= Date.now()) return false;
    record.expiresAt = Date.now() + this.options.activeTtlMs;
    return true;
  }
  async takeQuota(ip: string): Promise<boolean> {
    const now = Date.now();
    for (const [key, entry] of this.quotas)
      if (entry.expiresAt <= now) this.quotas.delete(key);
    if (!this.globalQuota || this.globalQuota.expiresAt <= now)
      this.globalQuota = { count: 0, expiresAt: now + this.options.ipWindowMs };
    if (this.globalQuota.count >= this.options.maxRegistrationAttempts)
      return false;
    this.globalQuota.count++;
    const key = hash(ip);
    let entry = this.quotas.get(key);
    if (!entry) {
      entry = { count: 0, expiresAt: now + this.options.ipWindowMs };
      this.quotas.set(key, entry);
    }
    if (entry.count >= this.options.ipLimit) return false;
    entry.count++;
    return true;
  }
}
// Atomic scripts use Redis server time for client expiry/cap accounting across instances.
const QUOTA_SCRIPT = `
local total=redis.call('INCR',KEYS[2])
if total==1 then redis.call('PEXPIRE',KEYS[2],ARGV[1]) end
if total>tonumber(ARGV[2]) then return 0 end
local n=redis.call('INCR',KEYS[1])
if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end
return n`;
const REGISTER_SCRIPT = `
local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[1]) then return 0 end
redis.call('SET',KEYS[2],ARGV[2],'PX',ARGV[3])
redis.call('ZADD',KEYS[1],now+tonumber(ARGV[3]),ARGV[4])
return 1`;
const USED_SCRIPT = `
if redis.call('EXISTS',KEYS[2])==0 then return 0 end
local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
redis.call('PEXPIRE',KEYS[2],ARGV[1])
redis.call('ZADD',KEYS[1],now+tonumber(ARGV[1]),ARGV[2])
return 1`;
type RedisClient = Pick<Redis, "get" | "call">;
export class RedisClientRegistry implements ClientRegistry {
  private readonly options: ReturnType<typeof config>;
  constructor(
    private readonly redis: RedisClient,
    private readonly prefix = "manychat-mcp:oauth",
    options: ClientRegistryConfig = {},
  ) {
    this.options = config(options);
  }
  private key(kind: string, id: string): string {
    return `${this.prefix}:${kind}:${id}`;
  }
  async register(
    name: string,
    redirectUris: string[],
  ): Promise<RegisteredClient> {
    const client = {
      clientId: randomUUID(),
      clientName: name,
      redirectUris: [...redirectUris],
      createdAt: Date.now(),
    };
    const result = await this.redis.call(
      "EVAL",
      REGISTER_SCRIPT,
      2,
      this.key("clients", "index"),
      this.key("client", client.clientId),
      this.options.maxClients,
      JSON.stringify(client),
      this.options.unusedTtlMs,
      client.clientId,
    );
    if (Number(result) !== 1) throw new ClientRegistrationLimitError();
    return client;
  }
  async get(id: string): Promise<RegisteredClient | null> {
    const raw = await this.redis.get(this.key("client", id));
    return raw ? (JSON.parse(raw) as RegisteredClient) : null;
  }
  async markUsed(id: string): Promise<boolean> {
    return (
      Number(
        await this.redis.call(
          "EVAL",
          USED_SCRIPT,
          2,
          this.key("clients", "index"),
          this.key("client", id),
          this.options.activeTtlMs,
          id,
        ),
      ) === 1
    );
  }
  async takeQuota(ip: string): Promise<boolean> {
    const count = Number(
      await this.redis.call(
        "EVAL",
        QUOTA_SCRIPT,
        2,
        this.key("quota", hash(ip)),
        this.key("quota", "global"),
        this.options.ipWindowMs,
        this.options.maxRegistrationAttempts,
      ),
    );
    return (
      Number.isSafeInteger(count) && count >= 1 && count <= this.options.ipLimit
    );
  }
}
