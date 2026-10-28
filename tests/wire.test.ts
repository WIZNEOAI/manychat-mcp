import { spawn, type ChildProcess } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { request as httpRequest } from "node:http";

const root = process.cwd();
const entry = resolve(root, "src/index.ts");
const deny = pathToFileURL(
  resolve(root, "tests/fixtures/deny-network.mjs"),
).href;
const packageJson = JSON.parse(
  await readFile(resolve(root, "package.json"), "utf8"),
) as { version: string };
const offlineKey = "wire-offline-test-key";

function child(args: string[], env: NodeJS.ProcessEnv = {}): ChildProcess {
  return spawn(
    process.execPath,
    ["--import", "tsx", "--import", deny, entry, ...args],
    {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}
function collect(stream: NodeJS.ReadableStream | null): {
  text: string;
  done: Promise<void>;
} {
  let text = "";
  let finish!: () => void;
  const done = new Promise<void>((resolveDone) => {
    finish = resolveDone;
  });
  stream?.setEncoding("utf8");
  stream?.on("data", (chunk) => {
    text += chunk;
  });
  stream?.on("end", finish);
  if (!stream) finish();
  return {
    get text() {
      return text;
    },
    done,
  };
}
async function stop(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  proc.kill("SIGTERM");
  const exited = once(proc, "exit").then(() => true);
  if (await Promise.race([exited, delay(1500).then(() => false)])) return;
  proc.kill("SIGKILL");
  await exited;
}
async function freePort(): Promise<number> {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not choose loopback port.");
  const port = address.port;
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
  return port;
}
function parseFrames(text: string): Array<Record<string, unknown>> {
  return text.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith("data: ")) return [];
    try {
      return [JSON.parse(line.slice(6)) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}
async function rpc(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
  extra: Record<string, string> = {},
) {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  });
  return await new Promise<Record<string, unknown>>(
    (resolveResponse, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/mcp",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            "MCP-Protocol-Version": "2026-07-28",
            "Mcp-Method": method,
            "Mcp-Name": method === "tools/call" ? String(params.name) : method,
            "x-manychat-api-key": offlineKey,
            Accept: "application/json",
            ...extra,
          },
        },
        (response) => {
          let raw = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            raw += chunk;
            const frames = parseFrames(raw);
            if (frames.length) {
              resolveResponse(frames[0]);
              response.destroy();
            }
          });
          response.on("end", () => {
            if (!raw)
              reject(
                new Error(`Empty MCP HTTP response (${response.statusCode}).`),
              );
            else if (!parseFrames(raw).length) {
              try {
                resolveResponse(JSON.parse(raw) as Record<string, unknown>);
              } catch {
                reject(
                  new Error(
                    `Invalid MCP HTTP response (${response.statusCode}): ${raw}`,
                  ),
                );
              }
            }
          });
          response.on("error", (error) => {
            if (!raw) reject(error);
          });
        },
      );
      req.setTimeout(5000, () =>
        req.destroy(new Error("MCP HTTP request timed out.")),
      );
      req.on("error", reject);
      req.end(payload);
    },
  );
}
async function waitListening(
  proc: ChildProcess,
  port: number,
  stderr: { readonly text: string },
): Promise<void> {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null)
      throw new Error(`HTTP child exited ${proc.exitCode}: ${stderr.text}`);
    try {
      await new Promise<void>((resolveConnect, reject) => {
        const req = httpRequest(
          { host: "127.0.0.1", port, path: "/health", method: "GET" },
          (response) => {
            response.resume();
            response.once("end", () => resolveConnect());
          },
        );
        req.setTimeout(500, () => req.destroy(new Error("Not ready")));
        req.once("error", reject);
        req.end();
      });
      return;
    } catch {
      await delay(40);
    }
  }
  throw new Error(`HTTP child did not listen: ${stderr.text}`);
}

describe("real CLI and MCP wire contracts (offline)", () => {
  it("reports package version without credentials and serves stdio discovery, list, and legacy initialize", async () => {
    for (const flag of ["--version", "-v"]) {
      const proc = child([flag], { MANYCHAT_API_KEY: "" });
      const stdout = collect(proc.stdout);
      const stderr = collect(proc.stderr);
      const [code] = await once(proc, "exit");
      await Promise.all([stdout.done, stderr.done]);
      expect(code).toBe(0);
      expect(stdout.text.trim()).toBe(packageJson.version);
      expect(stderr.text).toBe("");
    }
    const proc = child(["mcp", "serve", "--transport", "stdio"], {
      MANYCHAT_API_KEY: offlineKey,
    });
    const stdout = collect(proc.stdout);
    const stderr = collect(proc.stderr);
    try {
      for (const method of ["server/discover", "tools/list"]) {
        proc.stdin?.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: method, method, params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } })}\n`,
        );
        await viWait(() => stdout.text.includes(`"id":"${method}"`));
      }
      const frames = stdout.text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
      const discovered = frames.find((frame) => frame.id === "server/discover")
        ?.result as Record<string, unknown>;
      expect(discovered.supportedVersions).toContain("2026-07-28");
      const listed = frames.find((frame) => frame.id === "tools/list")
        ?.result as Record<string, unknown>;
      expect(listed.tools).toHaveLength(28);
      expect(stderr.text).not.toContain(offlineKey);
    } finally {
      proc.stdin?.end();
      await stop(proc);
      await Promise.all([stdout.done, stderr.done]);
    }
    // Protocol era is selected by the first message, not switchable mid-connection.
    const legacy = child(["mcp", "serve", "--transport", "stdio"], {
      MANYCHAT_API_KEY: offlineKey,
    });
    const legacyOut = collect(legacy.stdout);
    const legacyErr = collect(legacy.stderr);
    try {
      legacy.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: "legacy", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "wire-test", version: "1" } } })}\n`,
      );
      await viWait(() => legacyOut.text.includes('"id":"legacy"'));
      const response = legacyOut.text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((frame) => frame.id === "legacy");
      expect(response?.error).toBeUndefined();
      expect(response?.result).toMatchObject({
        protocolVersion: "2025-03-26",
      });
      expect(legacyErr.text).not.toContain(offlineKey);
    } finally {
      legacy.stdin?.end();
      await stop(legacy);
      await Promise.all([legacyOut.done, legacyErr.done]);
    }
  }, 20000);

  it("rejects a legacy version switch on a modern stdio connection and keeps its original era", async () => {
    const proc = child(["mcp", "serve", "--transport", "stdio"], {
      MANYCHAT_API_KEY: offlineKey,
    });
    const stdout = collect(proc.stdout);
    const stderr = collect(proc.stderr);
    const frame = async (
      id: string,
      method: string,
      params: Record<string, unknown>,
    ) => {
      proc.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
      await viWait(() => stdout.text.includes(`"id":"${id}"`));
      return stdout.text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .find((message) => message.id === id);
    };
    const modernMeta = {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    };
    try {
      const opening = await frame(
        "modern-opening",
        "server/discover",
        modernMeta,
      );
      expect(opening?.error).toBeUndefined();
      expect(
        (opening?.result as { supportedVersions: string[] }).supportedVersions,
      ).toContain("2026-07-28");
      // Discovery is a probe: a subsequent modern operation pins the era.
      // Exercise the established modern connection, not discovery fallback.
      const established = await frame(
        "modern-established",
        "tools/list",
        modernMeta,
      );
      expect(established?.error).toBeUndefined();
      expect((established?.result as { tools: unknown[] }).tools).toHaveLength(
        28,
      );
      const switched = await frame("forbidden-switch", "initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "wire-test", version: "1" },
      });
      expect(switched?.result).toBeUndefined();
      expect(switched?.error).toMatchObject({
        code: -32022,
        data: { requested: "2025-03-26", supported: ["2026-07-28"] },
      });
      const stillModern = await frame("still-modern", "tools/list", modernMeta);
      expect(stillModern?.error).toBeUndefined();
      expect((stillModern?.result as { tools: unknown[] }).tools).toHaveLength(
        28,
      );
      expect(stderr.text).not.toContain(offlineKey);
    } finally {
      proc.stdin?.end();
      await stop(proc);
      await Promise.all([stdout.done, stderr.done]);
    }
  }, 20000);

  it("routes three separate HTTP process lifetimes without session affinity and fails evidence closed offline", async () => {
    const ports = await Promise.all([freePort(), freePort(), freePort()]);
    const launch = (port: number) => {
      const proc = child(["mcp", "serve", "--transport", "http"], {
        HOST: "127.0.0.1",
        NODE_ENV: "development",
        PORT: String(port),
        MANYCHAT_API_KEY: "",
      });
      const stdout = collect(proc.stdout);
      const stderr = collect(proc.stderr);
      return { proc, stdout, stderr };
    };
    const processes = ports.map(launch);
    try {
      await Promise.all(
        processes.map((item, i) =>
          waitListening(item.proc, ports[i], item.stderr),
        ),
      );
      const [first, second, third] = processes;
      const discovery = await rpc(ports[0], "server/discover");
      expect(discovery.error).toBeUndefined();
      expect(
        (discovery.result as Record<string, unknown>).supportedVersions,
      ).toContain("2026-07-28");
      const listing = await rpc(ports[1], "tools/list");
      expect(listing.error).toBeUndefined();
      expect((listing.result as { tools: unknown[] }).tools).toHaveLength(28);
      const call = await rpc(ports[2], "tools/call", {
        name: "validate_message",
        arguments: { subscriber_id: 7 },
      });
      expect(call.error).toBeUndefined();
      const content = (call.result as { content: Array<{ text: string }> })
        .content;
      expect(JSON.parse(content[0].text)).toMatchObject({
        allowed: false,
        code: "EVIDENCE_UNAVAILABLE",
      });
      // Verify any instance handles a subsequent request, without a handshake there.
      const repeated = await rpc(ports[2], "tools/list");
      expect(repeated.error).toBeUndefined();
      for (const item of [first, second, third])
        expect(item.stderr.text).not.toContain(offlineKey);
    } finally {
      for (const item of processes) {
        await stop(item.proc);
        item.proc.stdin?.destroy();
      }
      await Promise.all(
        processes.flatMap((item) => [item.stdout.done, item.stderr.done]),
      );
    }
  }, 30000);
});
async function viWait(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate() && Date.now() < deadline) await delay(10);
  if (!predicate())
    throw new Error("Timed out waiting for MCP stdio response.");
}
