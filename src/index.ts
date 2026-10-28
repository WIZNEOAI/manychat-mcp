#!/usr/bin/env node
import { MANYCHAT_PRODUCT } from "./product.js";
import { HELP, runCli } from "./cli/app.js";
import { ExecutionEngine } from "./core/engine.js";
import { ManyChatClient } from "./core/manychat-client.js";
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--version", "-v"].includes(args[0])) { process.stdout.write(`${MANYCHAT_PRODUCT.version}\n`); return; }
  if (!args.length || (args.length === 1 && ["--help", "-h"].includes(args[0]))) { process.stdout.write(HELP); return; }
  if (args[0] === "mcp" && args[1] === "serve") {
    if (args.length !== 4 || args[2] !== "--transport" || !["http", "stdio"].includes(args[3])) throw new Error("Use mcp serve --transport stdio|http.");
    if (args[3] === "http") { const { startHttp } = await import("./mcp/http.js"); await startHttp(); return; }
    const { serveStdio } = await import("@modelcontextprotocol/server/stdio");
    const { createServer } = await import("./server.js");
    const key = process.env.MANYCHAT_API_KEY;
    if (!key) throw new Error("Set MANYCHAT_API_KEY in your environment, not in chat.");
    serveStdio(() => createServer(key), { onerror: () => { process.stderr.write("MCP stdio request failed.\n"); } });
    return;
  }
  const key = process.env.MANYCHAT_API_KEY;
  if (!key) throw new Error("Set MANYCHAT_API_KEY in your environment, not in chat.");
  process.exitCode = await runCli(args, new ExecutionEngine(new ManyChatClient(key)), { out: s => process.stdout.write(`${s}\n`), err: s => process.stderr.write(`${s}\n`) });
}
main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : "Command failed."}\n`); process.exitCode = 1; });
