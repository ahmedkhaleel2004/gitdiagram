#!/usr/bin/env node
// The Worker's production configuration, read from CF_ENV_FILE: a JSON object
// of names to values, or a dotenv file. Default:
// ~/.config/gitdiagram/cloudflare/production.env.json (never in the repo).
//
//   node scripts/cf-secrets.mjs --names   names only
//   node scripts/cf-secrets.mjs --shell   `export NAME='value'` lines, for the build
//   node scripts/cf-secrets.mjs           JSON, for `wrangler secret bulk`
//
// Values only ever go to stdout; pipe them, never print them.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const file =
  process.env.CF_ENV_FILE ??
  join(homedir(), ".config/gitdiagram/cloudflare/production.env.json");

// Injected by Vercel's platform or build system; they mean nothing (or the
// wrong thing) on Cloudflare.
const VERCEL_ONLY = /^(VERCEL($|_)|TURBO_|NX_DAEMON$)/;

function read() {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".json")) return JSON.parse(text);
  const values = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2];
    if (/^".*"$/s.test(value)) value = JSON.parse(value);
    else if (/^'.*'$/s.test(value)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

const secrets = Object.fromEntries(
  Object.entries(read()).filter(
    ([name, value]) =>
      /^[A-Z0-9_]+$/.test(name) &&
      !VERCEL_ONLY.test(name) &&
      typeof value === "string",
  ),
);

if (process.argv.includes("--names")) {
  console.log(Object.keys(secrets).sort().join("\n"));
} else if (process.argv.includes("--shell")) {
  for (const [name, value] of Object.entries(secrets))
    console.log(`export ${name}='${value.replaceAll("'", "'\\''")}'`);
} else {
  process.stdout.write(JSON.stringify(secrets));
}
