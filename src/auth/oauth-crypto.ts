import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const PREFIX = "enc:v1:";
export function oauthKeyId(id: string): string {
  return createHash("sha256").update(id).digest("hex");
}
export function parseOAuthEncryptionKey(key: string | undefined): Buffer {
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key))
    throw new Error("OAUTH_ENC_KEY must be exactly 64 hexadecimal characters.");
  return Buffer.from(key, "hex");
}
export function encryptOAuthRecord(
  value: unknown,
  key: Buffer,
  kind: string,
  hashedKey: string,
): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`${kind}:${hashedKey}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return (
    PREFIX +
    Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString(
      "base64url",
    )
  );
}
export function decryptOAuthRecord<T>(
  encoded: string,
  key: Buffer,
  kind: string,
  hashedKey: string,
): T {
  try {
    if (!encoded.startsWith(PREFIX)) throw new Error();
    const payload = Buffer.from(encoded.slice(PREFIX.length), "base64url");
    if (payload.length < 29) throw new Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      payload.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(`${kind}:${hashedKey}`));
    decipher.setAuthTag(payload.subarray(12, 28));
    const plaintext = Buffer.concat([
      decipher.update(payload.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as T;
  } catch {
    throw new Error("OAuth store data is invalid.");
  }
}
