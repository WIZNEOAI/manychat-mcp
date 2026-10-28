export interface ManyChatApi {
  get<T = unknown>(path: string, params?: Record<string, string>): Promise<T>;
  post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T>;
}
export class ManyChatError extends Error {
  constructor(public readonly statusCode: number) {
    super(
      `ManyChat request failed (HTTP ${statusCode}); no automatic write retry was attempted.`,
    );
  }
}
/** No automatic POST retries: a lost acknowledgement is not proof of a failed send. */
export class ManyChatClient implements ManyChatApi {
  constructor(private readonly apiKey: string) {
    if (!apiKey.trim() || /[\r\n]/.test(apiKey))
      throw new Error(
        "A valid ManyChat API key is required in the environment or request credential.",
      );
  }
  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
    params?: Record<string, string>,
  ): Promise<T> {
    if (!/^\/(page|subscriber|sending)\/[a-zA-Z]+$/.test(path))
      throw new Error("Invalid ManyChat endpoint.");
    const url = new URL(`https://api.manychat.com/fb${path}`);
    for (const [k, v] of Object.entries(params ?? {}))
      url.searchParams.set(k, v);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
        redirect: "error",
      });
    } catch {
      throw new Error(
        "ManyChat network request failed or timed out; delivery outcome may be unknown. Do not retry a send blindly.",
      );
    }
    if (!response.ok) throw new ManyChatError(response.status);
    let parsed: { status?: string; data?: T };
    try {
      parsed = (await response.json()) as typeof parsed;
    } catch {
      throw new Error("ManyChat returned an invalid response.");
    }
    if (parsed.status !== "success") throw new ManyChatError(response.status);
    return parsed.data as T;
  }
  get<T>(path: string, params?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", path, undefined, params);
  }
  post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", path, body);
  }
}
