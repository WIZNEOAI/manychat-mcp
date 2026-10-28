import type { ExecutionEngine } from "../core/engine.js";
import { MANYCHAT_PRODUCT } from "../product.js";
export interface CliIO {
  out(text: string): void;
  err(text: string): void;
}
export async function runCli(
  args: string[],
  engine: ExecutionEngine,
  io: CliIO,
): Promise<number> {
  try {
    const [group, action, ...rest] = args;
    let name: string;
    let input: unknown;
    if (group === "page" && action === "info" && rest.length === 0) {
      name = "get_page_info";
      input = {};
    } else if (group === "tags" && action === "list" && rest.length === 0) {
      name = "list_tags";
      input = {};
    } else if (
      group === "subscribers" &&
      action === "get" &&
      rest.length === 1
    ) {
      name = "get_subscriber";
      input = { subscriber_id: Number(rest[0]) };
    } else if (group === "validate" && action && rest.length === 0) {
      name = "validate_message";
      input = { subscriber_id: Number(action) };
    } else if (group === "send" && rest.length === 2) {
      const subscriber_id = Number(rest[0]);
      if (action === "text") {
        name = "send_text_message";
        input = { subscriber_id, text: rest[1] };
      } else if (action === "content") {
        name = "send_content";
        input = { subscriber_id, data: JSON.parse(rest[1]) };
      } else if (action === "flow") {
        name = "send_flow";
        input = { subscriber_id, flow_ns: rest[1] };
      } else throw new Error("Unknown send command.");
    } else if (group === "call" && action && rest.length === 1) {
      name = action;
      input = JSON.parse(rest[0]);
    } else throw new Error("Unknown command. Use manychat --help.");
    io.out(JSON.stringify(await engine.execute(name, input)));
    return 0;
  } catch (error) {
    io.err(error instanceof Error ? error.message : "Command failed.");
    return 1;
  }
}
export const HELP = `${MANYCHAT_PRODUCT.name}
Usage: manychat --version | --help
       manychat mcp serve --transport stdio|http
       manychat page info | tags list | subscribers get ID | validate ID
       manychat send text ID TEXT | send content ID JSON | send flow ID FLOW
       manychat call TOOL_NAME JSON
Credentials: MANYCHAT_API_KEY for stdio/CLI; X-ManyChat-API-Key per HTTP request.
Message, flow, tag, and subscriber-field writes may trigger automations; guarded operations fail closed without trusted evidence. No raw POST or policy override. HUMAN_AGENT requires server-side MANYCHAT_ALLOW_HUMAN_AGENT=1 and remains human-only (maximum seven days).
`;
