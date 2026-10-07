/**
 * Upper bound on the prompt Haiku 5.5 could be sent (free count_tokens calls,
 * no generation). The pipeline caps the user prompt by CHARACTERS
 * (repository-context.ts: tree 24,000, README 8,500, sources 48,000), so the
 * only way to more tokens is text that costs more tokens per character.
 *
 *   bun --conditions=react-server experiments/diagram-haiku/worst-case.ts
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { architectureOutputSchema } from "~/server/generate/architecture-output";
import { toTaggedMessage } from "~/server/generate/format";
import { SYSTEM_ARCHITECTURE_PROMPT } from "~/server/generate/prompts";

const client = new Anthropic({
  apiKey: readFileSync(
    `${homedir()}/.config/gitdiagram/anthropic-api-key`,
    "utf8",
  ).trim(),
});
const fill = (unit: string, length: number) =>
  unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
const cases: Record<string, string> = {
  "dense English prose": "The quick brown fox jumps over the lazy dog. ",
  "minified code/punctuation": "a=b?c:d;f(x[0],{y:1});if(!z){r+=q*2}//_$\n",
  "Chinese text":
    "这个仓库实现了一个高性能的分布式任务调度系统，支持多种存储后端。",
  "random hex (hashes, lockfile-like)":
    "9f3a7c1e0b4d82a6f5e1c7d3b8a04f62e19c5d7a",
  emoji: "🚀🔥✨🧪📦🛠️",
};
for (const [name, unit] of Object.entries(cases)) {
  const user = toTaggedMessage({
    file_tree: fill(unit, 24_000),
    readme: fill(unit, 8_500),
    source_files: fill(unit, 48_000),
  });
  const count = await client.messages.countTokens({
    model: "claude-haiku-5-5",
    system: SYSTEM_ARCHITECTURE_PROMPT,
    messages: [{ role: "user", content: user }],
    output_config: { format: zodOutputFormat(architectureOutputSchema) },
  });
  console.info(
    `${name}\t${user.length} chars\t${count.input_tokens} tokens\t${(user.length / count.input_tokens).toFixed(2)} chars/token`,
  );
}
