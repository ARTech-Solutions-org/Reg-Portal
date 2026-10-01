import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function encryptionSecret(): string {
  const secret = process.env.QR_TOKEN_ENCRYPTION_KEY ?? process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("A 32-character token encryption secret is required.");
  return secret;
}

function encryptionKey(): Buffer {
  return createHash("sha256").update(`eventdesk:qr-token:v1:${encryptionSecret()}`).digest();
}

function scannerLinkRecoveryKey(): Buffer {
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(encryptionSecret(), "utf8"),
    Buffer.from("eventdesk:key-derivation:v1", "utf8"),
    Buffer.from("eventdesk:scanner-link-copy:v1", "utf8"),
    32,
  ));
}

export function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptToken(value: string): string {
  const [version, ivPart, tagPart, ciphertextPart] = value.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !ciphertextPart) throw new Error("Encrypted QR token format is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptScannerLinkToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scannerLinkRecoveryKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `sc1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptScannerLinkToken(value: string): string {
  const [version, ivPart, tagPart, ciphertextPart] = value.split(".");
  if (version !== "sc1" || !ivPart || !tagPart || !ciphertextPart) throw new Error("Encrypted scanner link token format is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", scannerLinkRecoveryKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextPart, "base64url")), decipher.final()]).toString("utf8");
}
