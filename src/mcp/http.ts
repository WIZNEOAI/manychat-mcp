import express from "express";
import type { Server } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createServer } from "../server.js";
import {
  credentialHash,
  MemoryRateStore,
  RedisRateStore,
  type RateStore,
} from "./rate-limit.js";
import { createOAuthRouter } from "../auth/oauth-routes.js";
import { resolveApiKeyFromToken } from "../auth/oauth.js";
import { assertDurableOAuthStoreConfig } from "../auth/oauth-store.js";
export interface HttpOptions {
  env?: NodeJS.ProcessEnv;
  rateStore?: RateStore;
  ipLimit?: number;
  keyLimit?: number;
}
export function createHttpApp(options: HttpOptions = {}): {
  app: express.Express;
  close: () => Promise<void>;
} {
  const env = options.env ?? process.env;
  const auth = env.MCP_REMOTE_AUTH ?? "manychat_header";
  if (!["manychat_header", "oauth"].includes(auth))
    throw new Error("MCP_REMOTE_AUTH must be manychat_header or oauth.");
  if (env.NODE_ENV === "production" && !env.REDIS_URL)
    throw new Error(
      "Production HTTP requires REDIS_URL for shared rate limits.",
    );
  const proxyCidrs = (env.TRUST_PROXY_CIDRS ?? "")
    .split(",")
    .map((cidr) => cidr.trim())
    .filter(Boolean);
  const proxyHops = (env.TRUST_PROXY_HOPS ?? "").trim();
  if (proxyCidrs.length && proxyHops)
    throw new Error(
      "Configure only one of TRUST_PROXY_CIDRS or TRUST_PROXY_HOPS.",
    );
  if (proxyHops && (!/^[1-9]\d*$/.test(proxyHops) || Number(proxyHops) > 16))
    throw new Error("TRUST_PROXY_HOPS must be an integer from 1 to 16.");
  if (env.NODE_ENV === "production" && !proxyCidrs.length && !proxyHops)
    throw new Error(
      "Production HTTP requires TRUST_PROXY_CIDRS or TRUST_PROXY_HOPS.",
    );
  const app = express();
  app.disable("x-powered-by");
  app.set(
    "trust proxy",
    proxyCidrs.length ? proxyCidrs : proxyHops ? Number(proxyHops) : false,
  );
  if (auth === "oauth" && env.NODE_ENV === "production")
    assertDurableOAuthStoreConfig(env);
  const rate =
    options.rateStore ??
    (env.REDIS_URL ? new RedisRateStore(env.REDIS_URL) : new MemoryRateStore());
  const origins = (env.MCP_ALLOWED_ORIGINS ?? "").split(",").filter(Boolean);
  if (auth === "oauth")
    origins.push(new URL(env.MCP_BASE_URL ?? "http://localhost:3000").origin);
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "frame-ancestors 'none'; default-src 'none'; style-src 'unsafe-inline'",
    );
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
    next();
  });
  // Liveness stays available even when the application budget is exhausted.
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use(async (req, res, next) => {
    if (req.headers.origin && !origins.includes(req.headers.origin)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    try {
      if (
        !(await rate.take(
          `ip:${credentialHash(req.ip ?? req.socket.remoteAddress ?? "unknown")}`,
          options.ipLimit ?? 120,
        ))
      ) {
        res.setHeader("Retry-After", "60");
        res.status(429).json({ error: "Rate limit exceeded" });
        return;
      }
      next();
    } catch {
      res.status(503).json({ error: "Rate limiter unavailable" });
    }
  });
  app.use(express.json({ limit: 32768, inflate: false }));
  if (auth === "oauth") {
    const baseUrl = env.MCP_BASE_URL ?? "http://localhost:3000";
    const parsed = new URL(baseUrl);
    if (
      parsed.username ||
      parsed.password ||
      (env.NODE_ENV === "production" && parsed.protocol !== "https:")
    )
      throw new Error(
        "OAuth production requires an HTTPS public origin without credentials.",
      );
    app.use(
      express.urlencoded({ extended: false, limit: 32768, inflate: false }),
    );
    app.use(createOAuthRouter(baseUrl));
  }
  const handler = createMcpHandler((ctx) => {
    const key = ctx.authInfo?.extra?.manychatApiKey;
    if (typeof key !== "string")
      throw new Error("Missing execution credential.");
    return createServer(key, env.MANYCHAT_ALLOW_HUMAN_AGENT === "1");
  });
  const nodeHandler = toNodeHandler(handler, { onerror: () => {} });
  app.all("/mcp", async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).setHeader("Allow", "POST").end();
      return;
    }
    try {
      let key: string | null = null;
      if (auth === "manychat_header") {
        const candidate = req.headers["x-manychat-api-key"];
        key = typeof candidate === "string" ? candidate.trim() : null;
      } else {
        const bearer = req.headers.authorization;
        if (bearer?.startsWith("Bearer "))
          key = await resolveApiKeyFromToken(bearer.slice(7));
      }
      // Never fall back to a server environment key. Auth modes are exclusive.
      if (!key || key.length > 4096 || /[\r\n]/.test(key)) {
        res.status(401).json({ error: "Valid request credential required" });
        return;
      }
      if (
        !(await rate.take(`key:${credentialHash(key)}`, options.keyLimit ?? 60))
      ) {
        res.setHeader("Retry-After", "60");
        res.status(429).json({ error: "Rate limit exceeded" });
        return;
      }
      (req as express.Request & { auth?: unknown }).auth = {
        token: "",
        clientId: "manychat",
        scopes: [],
        extra: { manychatApiKey: key },
      };
      await nodeHandler(req, res, req.body);
    } catch {
      if (!res.headersSent)
        res.status(503).json({ error: "Request could not be completed" });
    }
  });
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(
    (
      error: { status?: number },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (!res.headersSent)
        res
          .status(error.status === 413 ? 413 : 400)
          .json({ error: "Invalid request body" });
    },
  );
  return { app, close: () => rate.close() };
}
export async function startHttp(
  env: NodeJS.ProcessEnv = process.env,
): Promise<Server> {
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be 1..65535.");
  const { app, close } = createHttpApp({ env });
  const server = await new Promise<Server>((resolve, reject) => {
    const s = app.listen(port, env.HOST ?? "0.0.0.0", () => resolve(s));
    s.once("error", reject);
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 10000;
  server.timeout = 35000;
  server.keepAliveTimeout = 5000;
  server.once("close", () => {
    void close();
  });
  return server;
}
