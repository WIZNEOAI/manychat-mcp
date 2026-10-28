import { beforeEach, vi } from "vitest";
// Local socket tests use node:http; accidental upstream fetches fail closed.
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network disabled in unit tests");
    }),
  );
});
