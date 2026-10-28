import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  type AccessToken,
  type AuthorizationCode,
  type OAuthStore,
  type RefreshToken,
  type RegisteredClient,
  createOAuthStoreFromEnv,
} from "./oauth-store.js";
import { log } from "../lib/logger.js";

interface OAuthTokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
}
const ttl = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer number of seconds.`);
  return value;
};
const authCodeTtl = ttl("OAUTH_AUTH_CODE_TTL_SEC", 300);
const accessTtl = ttl("OAUTH_ACCESS_TOKEN_TTL_SEC", 3600);
const refreshTtl = ttl("OAUTH_REFRESH_TOKEN_TTL_SEC", 60 * 60 * 24 * 30);
let oauthStore: OAuthStore | null = null;
const store = (): OAuthStore => (oauthStore ??= createOAuthStoreFromEnv());
async function audit(
  event: string,
  clientId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await store().appendAuditEvent({
    id: randomUUID(),
    event,
    clientId,
    details,
    createdAt: Date.now(),
  });
}
export function setOAuthStoreForTesting(value: OAuthStore): void {
  oauthStore = value;
}
export async function resolveApiKeyFromToken(
  bearerToken: string,
): Promise<string | null> {
  return (await store().getAccessToken(bearerToken))?.apiKey ?? null;
}
export async function registerClient(
  clientName: string,
  redirectUris: string[],
): Promise<RegisteredClient> {
  const client = await store().registerClient(clientName, redirectUris);
  await audit("oauth_client_registered", client.clientId, {
    redirectUrisCount: redirectUris.length,
  });
  log.info("oauth_client_registered", { clientId: client.clientId });
  return client;
}
export async function getClient(
  clientId: string,
): Promise<RegisteredClient | null> {
  return store().getClient(clientId);
}
export async function createAuthorizationCode(
  clientId: string,
  codeChallenge: string,
  codeChallengeMethod: "S256",
  redirectUri: string,
  apiKey: string,
): Promise<string> {
  const code = randomBytes(32).toString("hex");
  const payload: AuthorizationCode = {
    code,
    clientId,
    codeChallenge,
    codeChallengeMethod,
    redirectUri,
    apiKey,
    createdAt: Date.now(),
    expiresAt: Date.now() + authCodeTtl * 1000,
  };
  await store().saveAuthorizationCode(payload);
  await audit("oauth_code_created", clientId, { codeTtlSec: authCodeTtl });
  return code;
}
function accessRecord(clientId: string, apiKey: string): AccessToken {
  return {
    token: randomBytes(48).toString("hex"),
    clientId,
    apiKey,
    createdAt: Date.now(),
    expiresAt: Date.now() + accessTtl * 1000,
    revokedAt: null,
  };
}
function refreshRecord(clientId: string, apiKey: string): RefreshToken {
  return {
    token: randomBytes(48).toString("hex"),
    clientId,
    apiKey,
    createdAt: Date.now(),
    expiresAt: Date.now() + refreshTtl * 1000,
    revokedAt: null,
  };
}
function tokenResponse(
  access: AccessToken,
  refresh: RefreshToken,
): OAuthTokenResponse {
  return {
    access_token: access.token,
    token_type: "Bearer",
    expires_in: accessTtl,
    refresh_token: refresh.token,
  };
}
function validVerifier(verifier: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier);
}
function pkceMatches(verifier: string, challenge: string): boolean {
  return (
    validVerifier(verifier) &&
    createHash("sha256").update(verifier).digest("base64url") === challenge
  );
}
export async function exchangeCodeForToken(
  code: string,
  clientId: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthTokenResponse | null> {
  const entry = await store().takeAuthorizationCode(code);
  if (
    !entry ||
    entry.clientId !== clientId ||
    entry.redirectUri !== redirectUri ||
    entry.codeChallengeMethod !== "S256" ||
    !pkceMatches(codeVerifier, entry.codeChallenge)
  ) {
    await audit("oauth_code_exchange_failed", clientId, {
      reason: "invalid_grant",
    });
    return null;
  }
  const access = accessRecord(clientId, entry.apiKey);
  const refresh = refreshRecord(clientId, entry.apiKey);
  await store().saveAccessToken(access);
  await store().saveRefreshToken(refresh);
  await audit("oauth_token_issued", clientId);
  return tokenResponse(access, refresh);
}
export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
): Promise<OAuthTokenResponse | null> {
  const value = await store().takeRefreshToken(refreshToken);
  if (!value || value.clientId !== clientId) {
    await audit("oauth_refresh_failed", clientId, { reason: "invalid_grant" });
    return null;
  }
  const access = accessRecord(clientId, value.apiKey);
  const refresh = refreshRecord(clientId, value.apiKey);
  await store().saveAccessToken(access);
  await store().saveRefreshToken(refresh);
  await audit("oauth_refresh_succeeded", clientId);
  return tokenResponse(access, refresh);
}
export async function revokeToken(
  token: string,
  hint?: string,
): Promise<boolean> {
  if (hint === "refresh_token") {
    const ok = await store().revokeRefreshToken(token);
    if (ok) await audit("oauth_refresh_revoked");
    return ok;
  }
  if (hint === "access_token") {
    const ok = await store().revokeAccessToken(token);
    if (ok) await audit("oauth_access_revoked");
    return ok;
  }
  const [access, refresh] = await Promise.all([
    store().revokeAccessToken(token),
    store().revokeRefreshToken(token),
  ]);
  if (access || refresh) await audit("oauth_token_revoked");
  return access || refresh;
}
