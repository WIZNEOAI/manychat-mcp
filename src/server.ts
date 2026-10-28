import { McpServer } from "@modelcontextprotocol/server";
import { ExecutionEngine, operations } from "./core/engine.js";
import { ManyChatClient } from "./core/manychat-client.js";
import { MANYCHAT_PRODUCT } from "./product.js";
export function createServer(
  apiKey: string,
  allowHumanAgent = process.env.MANYCHAT_ALLOW_HUMAN_AGENT === "1",
): McpServer {
  const engine = new ExecutionEngine(new ManyChatClient(apiKey), undefined, {
    allowHumanAgent,
  });
  const server = new McpServer(MANYCHAT_PRODUCT, {
    instructions:
      "Read before writing. Message sends, flows, tags, and subscriber field changes may trigger automations and are guarded or blocked unless trusted evidence allows them. Missing interaction-channel evidence blocks sends. HUMAN_AGENT is disabled unless MANYCHAT_ALLOW_HUMAN_AGENT=1; it remains human-only and limited to seven days. Never put credentials in tool arguments or chat.",
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
