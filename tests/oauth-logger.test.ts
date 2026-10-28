import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../src/lib/logger.js";
describe("credential-safe errors", () => {
 afterEach(() => vi.restoreAllMocks());
 it("drops error message and metadata rather than risking credential disclosure", () => {
  const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
  log.error("failure with API_KEY=private", { error: "raw response with key", headers: { authorization: "Bearer private" }, apiKey: "private" });
  expect(output).toHaveBeenCalledOnce();
  const line = String(output.mock.calls[0]?.[0]);
  expect(line).not.toContain("private"); expect(line).not.toContain("raw response"); expect(line).toContain("operation_failed");
 });
});
