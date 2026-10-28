type LogLevel = "debug" | "info" | "warn" | "error";
const priority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
const configured = process.env.LOG_LEVEL;
const minLevel: LogLevel =
  configured && configured in priority ? (configured as LogLevel) : "info";
const sensitiveKey =
  /api.?key|token|secret|password|authorization|cookie|headers?/i;
function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[OMITTED]";
  if (typeof value === "string")
    return value.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  if (Array.isArray(value))
    return value.map((entry) => sanitize(entry, depth + 1));
  if (typeof value !== "object" || value === null) return value;
  const clean: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value))
    clean[key] = sensitiveKey.test(key)
      ? "[REDACTED]"
      : sanitize(entry, depth + 1);
  return clean;
}
function emit(
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (priority[level] < priority[minLevel]) return;
  // Error text may contain URLs, credentials, request headers, or provider responses.
  const safeMessage =
    level === "error"
      ? "operation_failed"
      : message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: safeMessage,
    ...(meta && level !== "error"
      ? (sanitize(meta) as Record<string, unknown>)
      : {}),
  };
  console.error(JSON.stringify(entry));
}
export const log = {
  debug: (message: string, meta?: Record<string, unknown>) =>
    emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) =>
    emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) =>
    emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) =>
    emit("error", message, meta),
};
