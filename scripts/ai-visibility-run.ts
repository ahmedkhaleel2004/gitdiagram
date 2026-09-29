// Runs today's AI-visibility questions now and stores the result, as the daily
// cron does (/api/internal/ai-visibility), then prints what each answer said.
// Costs about a dollar.
//
//   bun run ai-visibility:run
//
// Needs OPENAI_API_KEY, ANTHROPIC_API_KEY and the Upstash variables.
import { AI_VARIANTS } from "../src/features/admin/visibility";
import { AI_VISIBILITY_PROMPTS } from "../src/server/visibility/ai-answer";
import {
  getAiVisibility,
  runAiVisibility,
} from "../src/server/visibility/ai-visibility";

const summary = await runAiVisibility({
  deadline: Date.now() + 240_000,
  force: true,
});
if (!summary) throw new Error("The run did not start.");
const { latest } = await getAiVisibility(1);

console.log(
  `\n${summary.date}: $${summary.costUsd.toFixed(3)} in ${Math.round(summary.durationMs / 1000)} s (${summary.models.openai}, ${summary.models.anthropic})\n`,
);
for (const variant of AI_VARIANTS) {
  const stats = summary.variants[variant];
  console.log(
    `${variant.padEnd(17)} named ${stats.mentioned}/${stats.answered}, linked ${stats.cited}, marks ${summary.marks[variant]}`,
  );
}
console.log(
  "\nPer question (openai:search openai:memory claude:search claude:memory):",
);
AI_VISIBILITY_PROMPTS.forEach((prompt, index) => {
  const row = AI_VARIANTS.map((variant) => {
    const mark = summary.marks[variant][index];
    const answer = latest?.answers.find(
      (a) => a.promptId === prompt.id && a.variant === variant,
    );
    return `${mark}${answer?.position ? `#${answer.position}` : ""}`.padEnd(6);
  }).join(" ");
  console.log(`${row} ${prompt.text}`);
});
console.log(
  "\nOther tools named:",
  summary.competitors.map(([n, c]) => `${n} ${c}`).join(", "),
);
for (const answer of latest?.answers ?? [])
  if (answer.error)
    console.log(
      `failed: ${answer.variant} ${answer.promptId}: ${answer.error}`,
    );
