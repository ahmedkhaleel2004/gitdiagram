import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from "node:crypto";
import type { z } from "zod";

import { readRequiredEnv } from "~/server/storage/config";

const IV_BYTES = 12;
const TAG_BYTES = 16;

function sealKey(purpose: string): Buffer {
  return createHmac("sha256", readRequiredEnv("CACHE_KEY_SECRET"))
    .update(`gitdiagram:${purpose}:v1`)
    .digest();
}

/**
 * Encrypts and authenticates a small JSON value for a cookie (AES-256-GCM,
 * with the purpose as associated data so one cookie cannot stand in for
 * another). The browser holds it but can neither read nor alter it.
 */
export function seal(purpose: string, value: unknown): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", sealKey(purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
    "base64url",
  );
}

export function unseal<T>(
  purpose: string,
  sealed: string | undefined,
  schema: z.ZodType<T>,
): T | null {
  if (!sealed) return null;
  try {
    const bytes = Buffer.from(sealed, "base64url");
    if (bytes.length <= IV_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      sealKey(purpose),
      bytes.subarray(0, IV_BYTES),
    );
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const plaintext = Buffer.concat([
      decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
    const parsed = schema.safeParse(JSON.parse(plaintext));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
