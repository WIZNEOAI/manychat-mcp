import { Redis } from "ioredis";
import {
  MemoryClientRegistry,
  RedisClientRegistry,
  type ClientRegistry,
  type ClientRegistryConfig,
} from "./client-registry.js";
import {
  decryptOAuthRecord,
  encryptOAuthRecord,
  oauthKeyId,
  parseOAuthEncryptionKey,
} from "./oauth-crypto.js";
import { log } from "../lib/logger.js";

export interface RegisteredClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
}
export interface AuthorizationCode {
  code: string;
  clientId: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  redirectUri: string;
  apiKey: string;
  createdAt: number;
  expiresAt: number;
}
export interface AccessToken {
  token: string;
  clientId: string;
  apiKey: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}
export interface RefreshToken {
  token: string;
  clientId: string;
  apiKey: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}
export interface OAuthAuditEvent {
  id: string;
  event: string;
  clientId?: string;
  details?: Record<string, unknown>;
  createdAt: number;
}
export interface OAuthStore {
  registerClient(
    clientName: string,
    redirectUris: string[],
  ): Promise<RegisteredClient>;
  getClient(clientId: string): Promise<RegisteredClient | null>;
  takeRegistrationQuota(ip: string): Promise<boolean>;
  markClientUsed(clientId: string): Promise<boolean>;
  saveAuthorizationCode(code: AuthorizationCode): Promise<void>;
  takeAuthorizationCode(code: string): Promise<AuthorizationCode | null>;
  saveAccessToken(token: AccessToken): Promise<void>;
  getAccessToken(token: string): Promise<AccessToken | null>;
  revokeAccessToken(token: string): Promise<boolean>;
  saveRefreshToken(token: RefreshToken): Promise<void>;
  takeRefreshToken(token: string): Promise<RefreshToken | null>;
  revokeRefreshToken(token: string): Promise<boolean>;
  appendAuditEvent(event: OAuthAuditEvent): Promise<void>;
}
function validExpiry(expiry: number): boolean {
  return Number.isFinite(expiry) && expiry > Date.now();
}
export function resolveOAuthStoreMode(
  env: NodeJS.ProcessEnv = process.env,
): "memory" | "redis" {
  const mode = (env.OAUTH_STORE ?? "memory").toLowerCase();
  if (mode === "memory" || mode === "redis") return mode;
  throw new Error("OAUTH_STORE must be either 'memory' or 'redis'.");
}
export function assertDurableOAuthStoreConfig(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (resolveOAuthStoreMode(env) !== "redis" || !env.REDIS_URL)
    throw new Error(
      "Production OAuth over HTTP requires OAUTH_STORE=redis and REDIS_URL.",
    );
  parseOAuthEncryptionKey(env.OAUTH_ENC_KEY);
}
export class MemoryOAuthStore implements OAuthStore {
  private readonly clients: ClientRegistry;
  private readonly authCodes = new Map<string, AuthorizationCode>();
  private readonly accessTokens = new Map<string, AccessToken>();
  private readonly refreshTokens = new Map<string, RefreshToken>();
  private readonly auditEvents: OAuthAuditEvent[] = [];
  private readonly cleanupTimer: NodeJS.Timeout;
  constructor(registryConfig: ClientRegistryConfig = {}) {
    this.clients = new MemoryClientRegistry(registryConfig);
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref();
  }
  close(): void {
    clearInterval(this.cleanupTimer);
  }
  async registerClient(
    clientName: string,
    redirectUris: string[],
  ): Promise<RegisteredClient> {
    return this.clients.register(clientName, redirectUris);
  }
  async getClient(id: string): Promise<RegisteredClient | null> {
    return this.clients.get(id);
  }
  async takeRegistrationQuota(ip: string): Promise<boolean> {
    return this.clients.takeQuota(ip);
  }
  async markClientUsed(id: string): Promise<boolean> {
    return this.clients.markUsed(id);
  }
  async saveAuthorizationCode(code: AuthorizationCode): Promise<void> {
    this.authCodes.set(code.code, { ...code });
  }
  async takeAuthorizationCode(code: string): Promise<AuthorizationCode | null> {
    const entry = this.authCodes.get(code);
    if (!entry) return null;
    this.authCodes.delete(code);
    return validExpiry(entry.expiresAt) ? entry : null;
  }
  async saveAccessToken(token: AccessToken): Promise<void> {
    this.accessTokens.set(token.token, { ...token });
  }
  async getAccessToken(token: string): Promise<AccessToken | null> {
    const entry = this.accessTokens.get(token);
    return entry && entry.revokedAt === null && validExpiry(entry.expiresAt)
      ? entry
      : null;
  }
  async revokeAccessToken(token: string): Promise<boolean> {
    const entry = this.accessTokens.get(token);
    if (!entry || entry.revokedAt !== null) return false;
    this.accessTokens.set(token, { ...entry, revokedAt: Date.now() });
    return true;
  }
  async saveRefreshToken(token: RefreshToken): Promise<void> {
    this.refreshTokens.set(token.token, { ...token });
  }
  async takeRefreshToken(token: string): Promise<RefreshToken | null> {
    const entry = this.refreshTokens.get(token);
    if (!entry) return null;
    this.refreshTokens.delete(token);
    return entry.revokedAt === null && validExpiry(entry.expiresAt)
      ? entry
      : null;
  }
  async revokeRefreshToken(token: string): Promise<boolean> {
    return this.refreshTokens.delete(token);
  }
  async appendAuditEvent(event: OAuthAuditEvent): Promise<void> {
    this.auditEvents.push(event);
    if (this.auditEvents.length > 5000)
      this.auditEvents.splice(0, this.auditEvents.length - 5000);
  }
  private cleanup(): void {
    for (const [key, value] of this.authCodes)
      if (!validExpiry(value.expiresAt)) this.authCodes.delete(key);
    for (const [key, value] of this.accessTokens)
      if (!validExpiry(value.expiresAt)) this.accessTokens.delete(key);
    for (const [key, value] of this.refreshTokens)
      if (!validExpiry(value.expiresAt)) this.refreshTokens.delete(key);
  }
}
type RedisClient = Pick<Redis, "set" | "get" | "del" | "call" | "multi">;
export class RedisOAuthStore implements OAuthStore {
  private readonly redis: RedisClient;
  private readonly encryptionKey: Buffer;
  private readonly clients: ClientRegistry;
  constructor(
    redisUrl: string,
    private readonly prefix = "manychat-mcp:oauth",
    client?: RedisClient,
    encryptionKey = process.env.OAUTH_ENC_KEY,
  ) {
    this.encryptionKey = parseOAuthEncryptionKey(encryptionKey);
    this.redis = client ?? new Redis(redisUrl, { lazyConnect: false });
    this.clients = new RedisClientRegistry(this.redis, this.prefix);
  }
  private key(kind: string, id?: string): string {
    return id
      ? `${this.prefix}:${kind}:${oauthKeyId(id)}`
      : `${this.prefix}:${kind}`;
  }
  private encode(kind: string, id: string, value: unknown): string {
    return encryptOAuthRecord(value, this.encryptionKey, kind, oauthKeyId(id));
  }
  private decode<T>(kind: string, id: string, raw: string): T {
    return decryptOAuthRecord<T>(raw, this.encryptionKey, kind, oauthKeyId(id));
  }
  async registerClient(
    clientName: string,
    redirectUris: string[],
  ): Promise<RegisteredClient> {
    return this.clients.register(clientName, redirectUris);
  }
  async getClient(id: string): Promise<RegisteredClient | null> {
    return this.clients.get(id);
  }
  async takeRegistrationQuota(ip: string): Promise<boolean> {
    return this.clients.takeQuota(ip);
  }
  async markClientUsed(id: string): Promise<boolean> {
    return this.clients.markUsed(id);
  }
  async saveAuthorizationCode(code: AuthorizationCode): Promise<void> {
    await this.setExpiring("auth_code", code.code, code, code.expiresAt);
  }
  async takeAuthorizationCode(code: string): Promise<AuthorizationCode | null> {
    const entry = await this.getdel<AuthorizationCode>("auth_code", code);
    return entry && validExpiry(entry.expiresAt) ? entry : null;
  }
  async saveAccessToken(token: AccessToken): Promise<void> {
    await this.setExpiring("access_token", token.token, token, token.expiresAt);
  }
  async getAccessToken(token: string): Promise<AccessToken | null> {
    const raw = await this.redis.get(this.key("access_token", token));
    if (!raw) return null;
    const entry = this.decode<AccessToken>("access_token", token, raw);
    return entry.revokedAt === null && validExpiry(entry.expiresAt)
      ? entry
      : null;
  }
  async revokeAccessToken(token: string): Promise<boolean> {
    const key = this.key("access_token", token),
      raw = await this.redis.get(key);
    if (!raw) return false;
    const entry = this.decode<AccessToken>("access_token", token, raw);
    if (entry.revokedAt !== null) return false;
    entry.revokedAt = Date.now();
    await this.setExpiring("access_token", token, entry, entry.expiresAt);
    return true;
  }
  async saveRefreshToken(token: RefreshToken): Promise<void> {
    await this.setExpiring(
      "refresh_token",
      token.token,
      token,
      token.expiresAt,
    );
  }
  async takeRefreshToken(token: string): Promise<RefreshToken | null> {
    const entry = await this.getdel<RefreshToken>("refresh_token", token);
    return entry && entry.revokedAt === null && validExpiry(entry.expiresAt)
      ? entry
      : null;
  }
  async revokeRefreshToken(token: string): Promise<boolean> {
    return (await this.redis.del(this.key("refresh_token", token))) > 0;
  }
  async appendAuditEvent(event: OAuthAuditEvent): Promise<void> {
    const key = this.key("audit");
    await this.redis
      .multi()
      .lpush(key, JSON.stringify(event))
      .ltrim(key, 0, 4999)
      .exec();
  }
  private async getdel<T>(kind: string, id: string): Promise<T | null> {
    const raw = await this.redis.call("GETDEL", this.key(kind, id));
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== "string")
      throw new Error("OAuth store returned invalid data.");
    return this.decode<T>(kind, id, raw);
  }
  private async setExpiring(
    kind: string,
    id: string,
    value: unknown,
    expiresAt: number,
  ): Promise<void> {
    const ttl = Math.floor((expiresAt - Date.now()) / 1000);
    if (ttl < 1) throw new Error("OAuth credential expired before storage.");
    await this.redis.set(
      this.key(kind, id),
      this.encode(kind, id, value),
      "EX",
      ttl,
    );
  }
}
export function createOAuthStoreFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): OAuthStore {
  const mode = resolveOAuthStoreMode(env);
  if (mode === "redis") {
    if (!env.REDIS_URL)
      throw new Error("REDIS_URL is required when OAUTH_STORE=redis.");
    if (env.NODE_ENV === "production")
      parseOAuthEncryptionKey(env.OAUTH_ENC_KEY);
    return new RedisOAuthStore(
      env.REDIS_URL,
      "manychat-mcp:oauth",
      undefined,
      env.OAUTH_ENC_KEY,
    );
  }
  if (env.NODE_ENV === "production")
    throw new Error(
      "Production OAuth requires OAUTH_STORE=redis and REDIS_URL.",
    );
  log.warn("oauth_memory_store_enabled", {
    warning:
      "In-memory OAuth state is development-only and is lost on restart.",
  });
  return new MemoryOAuthStore();
}
