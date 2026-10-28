import { McpServer } from "@modelcontextprotocol/server";
import { ExecutionEngine, operations } from "./core/engine.js";
import { ManyChatClient } from "./core/manychat-client.js";
import { MANYCHAT_PRODUCT } from "./product.js";
export function createServer(apiKey: string): McpServer {
  const engine = new ExecutionEngine(new ManyChatClient(apiKey));
  const server = new McpServer(MANYCHAT_PRODUCT, {
    instructions:
      "Read before writing. Call validate_message before sending. Every send rechecks authoritative evidence; there is no policy override. Missing interaction-channel evidence blocks sends. Never put credentials in tool arguments or chat.",
  });
  for (const [name, op] of Object.entries(operations)) {
    server.registerTool(
      name,
      { description: op.description, inputSchema: op.schema },
      async (args) => {
        try {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(await engine.execute(name, args)),
              },
            ],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text:
                  error instanceof Error ? error.message : "Operation failed.",
              },
            ],
          };
        }
      },
    );
  }
  return server;
}
