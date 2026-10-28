import { Router, type Request, type Response } from "express";
import {
  registerClient,
  getClient,
  createAuthorizationCode,
  exchangeCodeForToken,
  refreshAccessToken,
  revokeToken,
} from "./oauth.js";
import { log } from "../lib/logger.js";
const fail = (res: Response, status: number, error: string): void => {
  res.status(status).json({ error });
};
const isString = (value: unknown): value is string => typeof value === "string";
function safeRedirect(uri: unknown): uri is string {
  if (!isString(uri) || uri.length > 2048) return false;
  try {
    const url = new URL(uri);
    if (url.username || url.password || url.hash) return false;
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}
const query = (value: unknown): string | null =>
  isString(value) ? value : null;
export function createOAuthRouter(serverBaseUrl: string): Router {
  const router = Router();
  let issuer: URL;
  try {
    issuer = new URL(serverBaseUrl);
  } catch {
    throw new Error("OAuth issuer must be an absolute URL.");
  }
  if (
    issuer.protocol !== "https:" &&
    !(
      issuer.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(issuer.hostname)
    )
  )
    throw new Error("OAuth issuer must use HTTPS.");
  const base = issuer.toString().replace(/\/$/, "");
  router.get("/.well-known/oauth-protected-resource", (_req, res) =>
    res.json({
      resource: base,
      authorization_servers: [base],
      bearer_methods_supported: ["header"],
    }),
  );
  router.get("/.well-known/oauth-authorization-server", (_req, res) =>
    res.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      revocation_endpoint: `${base}/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
    }),
  );
  router.post("/register", async (req: Request, res: Response) => {
    try {
      const name = req.body?.client_name;
      const uris = req.body?.redirect_uris;
      if (
        !isString(name) ||
        !name.trim() ||
        name.length > 128 ||
        !Array.isArray(uris) ||
        uris.length < 1 ||
        uris.length > 10 ||
        !uris.every(safeRedirect)
      )
        return fail(res, 400, "invalid_client_metadata");
      const client = await registerClient(name.trim(), uris);
      return res.status(201).json({
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
      });
    } catch {
      log.error("oauth registration failed");
      return fail(res, 500, "server_error");
    }
  });
  router.get("/authorize", async (req: Request, res: Response) => {
    try {
      const clientId = query(req.query.client_id);
      const redirectUri = query(req.query.redirect_uri);
      const challenge = query(req.query.code_challenge);
      const method = query(req.query.code_challenge_method);
      const responseType = query(req.query.response_type);
      const state = query(req.query.state) ?? "";
      if (
        !clientId ||
        !redirectUri ||
        !safeRedirect(redirectUri) ||
        responseType !== "code" ||
        !challenge ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
        method !== "S256" ||
        state.length > 1024
      )
        return fail(res, 400, "invalid_request");
      const client = await getClient(clientId);
      if (!client || !client.redirectUris.includes(redirectUri))
        return fail(res, 400, "invalid_request");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res
        .type("html")
        .send(renderAuthPage(clientId, redirectUri, challenge, state));
    } catch {
      log.error("oauth authorization page failed");
      return fail(res, 500, "server_error");
    }
  });
  router.post("/authorize", async (req: Request, res: Response) => {
    try {
      const {
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: method,
        state,
        api_key: apiKey,
      } = req.body ?? {};
      if (
        !isString(clientId) ||
        !isString(redirectUri) ||
        !safeRedirect(redirectUri) ||
        !isString(challenge) ||
        !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
        method !== "S256" ||
        !isString(state) ||
        state.length > 1024 ||
        !isString(apiKey) ||
        apiKey.trim().length < 8 ||
        apiKey.length > 512
      )
        return fail(res, 400, "invalid_request");
      const client = await getClient(clientId);
      if (!client || !client.redirectUris.includes(redirectUri))
        return fail(res, 400, "invalid_request");
      const code = await createAuthorizationCode(
        clientId,
        challenge,
        "S256",
        redirectUri,
        apiKey.trim(),
      );
      const destination = new URL(redirectUri);
      destination.searchParams.set("code", code);
      if (state) destination.searchParams.set("state", state);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      return res.redirect(302, destination.toString());
    } catch {
      log.error("oauth authorization failed");
      return fail(res, 500, "server_error");
    }
  });
  router.post("/token", async (req: Request, res: Response) => {
    try {
      const body = req.body ?? {};
      let result;
      if (body.grant_type === "authorization_code") {
        if (
          ![
            body.code,
            body.client_id,
            body.code_verifier,
            body.redirect_uri,
          ].every(isString) ||
          !safeRedirect(body.redirect_uri)
        )
          return fail(res, 400, "invalid_request");
        result = await exchangeCodeForToken(
          body.code,
          body.client_id,
          body.code_verifier,
          body.redirect_uri,
        );
      } else if (body.grant_type === "refresh_token") {
        if (!isString(body.refresh_token) || !isString(body.client_id))
          return fail(res, 400, "invalid_request");
        result = await refreshAccessToken(body.refresh_token, body.client_id);
      } else return fail(res, 400, "unsupported_grant_type");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Pragma", "no-cache");
      if (!result) return fail(res, 400, "invalid_grant");
      return res.json(result);
    } catch {
      log.error("oauth token request failed");
      return fail(res, 500, "server_error");
    }
  });
  router.post("/revoke", async (req: Request, res: Response) => {
    try {
      const { token, token_type_hint: hint } = req.body ?? {};
      if (
        !isString(token) ||
        !token ||
        token.length > 512 ||
        (hint !== undefined &&
          hint !== "access_token" &&
          hint !== "refresh_token")
      )
        return fail(res, 400, "invalid_request");
      await revokeToken(token, hint);
      return res.status(200).json({});
    } catch {
      log.error("oauth revocation failed");
      return fail(res, 500, "server_error");
    }
  });
  return router;
}
function renderAuthPage(
  clientId: string,
  redirectUri: string,
  challenge: string,
  state: string,
): string {
  const esc = (value: string): string =>
    value.replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char]!,
    );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect ManyChat</title></head><body><main><h1>Connect ManyChat</h1><form method="post" action="/authorize"><input type="hidden" name="client_id" value="${esc(clientId)}"><input type="hidden" name="redirect_uri" value="${esc(redirectUri)}"><input type="hidden" name="code_challenge" value="${esc(challenge)}"><input type="hidden" name="code_challenge_method" value="S256"><input type="hidden" name="state" value="${esc(state)}"><label for="api_key">ManyChat API key</label><input id="api_key" type="password" name="api_key" autocomplete="off" required><button type="submit">Connect</button></form></main></body></html>`;
}
