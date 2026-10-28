import { describe, expect, it, vi } from "vitest";
import { ManyChatClient } from "../src/core/manychat-client.js";

const key = "offline-client-canary-key";
const success = (data: unknown = { ok: true }) =>
  new Response(JSON.stringify({ status: "success", data }), { status: 200 });

describe("ManyChat client transport safety", () => {
  it("does not retry a write after HTTP failure or uncertain network delivery", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ secret: key }), { status: 500 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ManyChatClient(key);
    await expect(
      client.post("/sending/sendContent", { data: { message: "hello" } }),
    ).rejects.toThrow("HTTP 500");
    expect(fetchMock).toHaveBeenCalledOnce();
    fetchMock.mockReset().mockRejectedValue(new Error(`unsafe echo ${key}`));
    await expect(
      client.post("/sending/sendContent", { data: { message: "hello" } }),
    ).rejects.toThrow(/outcome may be unknown/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses an abort timeout, rejects URL injection, and forbids redirects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(success());
    vi.stubGlobal("fetch", fetchMock);
    const client = new ManyChatClient(key);
    await client.get("/page/getInfo");
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.origin).toBe("https://api.manychat.com");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(options.signal?.aborted).toBe(false);
    expect(options.redirect).toBe("error");
    for (const path of [
      "//attacker.example/path",
      "/page/getInfo?next=https://attacker.example",
      "/page/../subscriber/getInfo",
      "https://attacker.example/page/getInfo",
    ]) {
      await expect(client.get(path)).rejects.toThrow(
        "Invalid ManyChat endpoint",
      );
    }
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("never exposes credentials, including when upstream errors echo them", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(`{ "message": "${key}" }`, { status: 401 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const client = new ManyChatClient(key);
    let error: unknown;
    try {
      await client.get("/page/getInfo");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(key);
    expect(
      JSON.stringify({
        message: (error as Error).message,
        stack: (error as Error).stack,
      }),
    ).not.toContain(key);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
