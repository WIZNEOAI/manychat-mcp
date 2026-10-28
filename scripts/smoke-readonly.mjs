// Explicitly opt-in: GET only, never included in the offline suite.
const key = process.env.MANYCHAT_API_KEY;
const name = process.env.MANYCHAT_SMOKE_SUBSCRIBER_NAME;
if (!key || !name)
  throw new Error(
    "Set MANYCHAT_API_KEY and MANYCHAT_SMOKE_SUBSCRIBER_NAME locally. Never put keys in chat.",
  );
for (const path of [
  "/page/getInfo",
  "/page/getTags",
  `/subscriber/findByName?name=${encodeURIComponent(name)}`,
]) {
  const response = await fetch(`https://api.manychat.com/fb${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  const body = await response.json();
  if (!response.ok || body.status !== "success")
    throw new Error(`Read-only smoke failed (HTTP ${response.status})`);
  console.log(JSON.stringify({ operation: path.split("?")[0], ok: true }));
}
