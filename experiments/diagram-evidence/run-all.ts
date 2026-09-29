/**
 * Every eval repository through run.ts at once.
 *
 *   bun experiments/diagram-evidence/run-all.ts <label> [samples]
 */
import expected from "./expected.json";

const [label, samples = "3"] = process.argv.slice(2);
if (!label) throw new Error("usage: run-all.ts <label> [samples]");
const runs = Object.keys(expected).map(async (slug) => {
  const child = Bun.spawn(
    [
      "bun",
      "--conditions=react-server",
      "experiments/diagram-evidence/run.ts",
      label,
      slug,
      samples,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [output, errors] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  await child.exited;
  const lines = output
    .split("\n")
    .filter((line) => /nodes,|FAILED/.test(line))
    .join("\n");
  console.info(lines || `${slug}: ${errors.slice(-500)}`);
});
await Promise.all(runs);
