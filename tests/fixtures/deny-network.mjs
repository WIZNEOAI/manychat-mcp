// Preload used only by child-process wire tests; allow loopback HTTP clients, deny external fetch.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const target =
    input instanceof URL
      ? input
      : new URL(typeof input === "string" ? input : input.url);
  if (
    target.hostname === "127.0.0.1" ||
    target.hostname === "::1" ||
    target.hostname === "localhost"
  ) {
    return nativeFetch(input, init);
  }
  throw new Error(`External network disabled in wire test (${target.origin}).`);
};
