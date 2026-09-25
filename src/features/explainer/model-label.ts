// How a planner model is named to people: "Claude Opus 5.5", "GPT-6 Sol".
const LABELS: Array<[RegExp, string]> = [
  [/^claude-fable-5-1/, "Claude Fable 5.1"],
  [/^claude-opus-5-5/, "Claude Opus 5.5"],
  [/^claude-opus-5/, "Claude Opus 5"],
  [/^claude-sonnet-5/, "Claude Sonnet 5"],
  [/^gpt-6-astra/, "GPT-6 Astra"],
  [/^gpt-6-sol/, "GPT-6 Sol"],
  [/^gpt-6-luna/, "GPT-6 Luna"],
];

export function modelLabel(model: string): string {
  return LABELS.find(([pattern]) => pattern.test(model))?.[1] ?? model;
}
