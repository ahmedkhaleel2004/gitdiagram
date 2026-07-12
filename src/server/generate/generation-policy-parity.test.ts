import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EXPLANATION_MAX_OUTPUT_TOKENS,
  EXPLANATION_REASONING_EFFORT,
  EXPLANATION_TEXT_VERBOSITY,
  GRAPH_MAX_OUTPUT_TOKENS,
  GRAPH_REASONING_EFFORT,
  GRAPH_TEXT_VERBOSITY,
} from "~/server/generate/generation-policy";
import {
  SYSTEM_FIRST_PROMPT,
  SYSTEM_GRAPH_PROMPT,
} from "~/server/generate/prompts";

function extractTripleQuoted(source: string, name: string): string {
  const match = source.match(
    new RegExp(`${name}\\s*=\\s*\"\"\"([\\s\\S]*?)\"\"\"`),
  );
  if (!match?.[1]) throw new Error(`Could not find Python string ${name}.`);
  return match[1];
}

function extractPythonString(source: string, name: string): string {
  const match = source.match(
    new RegExp(`^${name}(?:\\s*:[^=]+)?\\s*=\\s*\"([^\"]+)\"`, "m"),
  );
  if (!match?.[1]) throw new Error(`Could not find Python value ${name}.`);
  return match[1];
}

function extractPythonInteger(source: string, name: string): number {
  const match = source.match(new RegExp(`^${name}\\s*=\\s*([0-9_]+)`, "m"));
  if (!match?.[1]) throw new Error(`Could not find Python value ${name}.`);
  return Number(match[1].replaceAll("_", ""));
}

describe("TypeScript and Python generation parity", () => {
  const pythonPrompts = readFileSync(
    resolve(process.cwd(), "backend/app/prompts.py"),
    "utf8",
  );
  const pythonPolicy = readFileSync(
    resolve(process.cwd(), "backend/app/services/generation_policy.py"),
    "utf8",
  );

  it("keeps prompts byte-for-byte aligned", () => {
    expect(extractTripleQuoted(pythonPrompts, "SYSTEM_FIRST_PROMPT")).toBe(
      SYSTEM_FIRST_PROMPT,
    );
    expect(extractTripleQuoted(pythonPrompts, "SYSTEM_GRAPH_PROMPT")).toBe(
      SYSTEM_GRAPH_PROMPT,
    );
  });

  it("keeps stage policy values aligned", () => {
    expect(
      extractPythonString(pythonPolicy, "EXPLANATION_REASONING_EFFORT"),
    ).toBe(EXPLANATION_REASONING_EFFORT);
    expect(extractPythonString(pythonPolicy, "GRAPH_REASONING_EFFORT")).toBe(
      GRAPH_REASONING_EFFORT,
    );
    expect(
      extractPythonString(pythonPolicy, "EXPLANATION_TEXT_VERBOSITY"),
    ).toBe(EXPLANATION_TEXT_VERBOSITY);
    expect(extractPythonString(pythonPolicy, "GRAPH_TEXT_VERBOSITY")).toBe(
      GRAPH_TEXT_VERBOSITY,
    );
    expect(
      extractPythonInteger(pythonPolicy, "EXPLANATION_MAX_OUTPUT_TOKENS"),
    ).toBe(EXPLANATION_MAX_OUTPUT_TOKENS);
    expect(extractPythonInteger(pythonPolicy, "GRAPH_MAX_OUTPUT_TOKENS")).toBe(
      GRAPH_MAX_OUTPUT_TOKENS,
    );
  });
});
