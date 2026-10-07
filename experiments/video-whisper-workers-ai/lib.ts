// Shared helpers for the Workers AI whisper experiment. Nothing here writes
// to production: it reads public artifacts and audio from gitdiagram.com and
// calls transcription APIs.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const HERE = import.meta.dir;
export const DATA = join(HERE, "out");
mkdirSync(DATA, { recursive: true });

export const ACCOUNT = "8a4f309f2639721dc9f4f0d1790fd6d5";
export const cloudflareToken = () =>
  readFileSync(
    join(homedir(), ".config/gitdiagram/cloudflare-api-token"),
    "utf8",
  ).trim();

/** OPENAI_API_KEY from the main checkout's .env (never printed). */
export function openAiKey(): string {
  const env = readFileSync("/home/ahmed/repos/gitdiagram/.env", "utf8");
  const line = env.split("\n").find((l) => l.startsWith("OPENAI_API_KEY="));
  if (!line) throw new Error("No OPENAI_API_KEY in the main checkout's .env");
  return line
    .slice("OPENAI_API_KEY=".length)
    .trim()
    .replace(/^["']|["']$/g, "");
}

export const cf = (path: string, init: RequestInit = {}) =>
  fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cloudflareToken()}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

export interface Heard {
  word: string;
  start: number;
  end: number;
}

export interface Sample {
  owner: string;
  repo: string;
  slug: string;
  createdAt: string;
  mp3: string;
  /** Length of the MP3 in seconds (ffprobe). */
  seconds: number;
  /** The beats as the plan stores them: what narrateBeats was given. */
  beats: Array<{ narration: string; scene: string }>;
  /** The timing stored in production (made with whisper-1 at the time). */
  stored: {
    DURATION: number;
    SPEECH_END: number;
    beats: Array<{
      start: number;
      end: number;
      words: Array<{ w: string; s: number; e: number }>;
    }>;
  };
}

export const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(file, "utf8")) as T;
export const writeJson = (file: string, value: unknown) =>
  writeFileSync(file, JSON.stringify(value, null, 1));
export const cached = async <T>(
  file: string,
  make: () => Promise<T>,
): Promise<T> => {
  if (existsSync(file)) return readJson<T>(file);
  const value = await make();
  writeJson(file, value);
  return value;
};

export const median = (values: number[]) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
};
export const percentile = (values: number[], p: number) => {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;
};
