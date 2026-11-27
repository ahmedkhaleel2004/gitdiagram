import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";

// A film can follow one part of a repository instead of its whole story: a
// short brief from the operator. It is data, never instructions (see
// directorTask), and its film is stored apart from the repository's own
// (see store.ts), so it can never replace or be served as that film.

export const FOCUS_MAX_LENGTH = 280;

/** Trimmed, with control and invisible format characters and runs of whitespace made one space. */
export const focusSchema = z
  .string()
  .transform((value) => value.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim())
  .pipe(z.string().min(1).max(FOCUS_MAX_LENGTH));

/** What names a focused film's files: a stable hash of its normalised brief. */
export const focusKey = (focus: string) =>
  createHash("sha256").update(focus).digest("hex").slice(0, 16);

/** A focus key as it may appear in a request. */
export const FOCUS_KEY = /^[0-9a-f]{16}$/;
