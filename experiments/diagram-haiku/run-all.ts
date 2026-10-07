/**
 * Every eval repository through run.ts, three repositories at a time.
 *
 *   bun experiments/diagram-haiku/run-all.ts <samples> <arm,arm,...> [repo-filter]
 */
import expected from "./expected.json";

const [samples = "3", arms = "luna,luna-std,haiku-low,haiku-medium", only] =
  process.argv.slice(2);
const queue = Object.keys(expected).filter(
  (slug) => !only || slug.includes(only),
);
const worker = async () => {
  for (let slug = queue.shift(); slug; slug = queue.shift()) {
    const child = Bun.spawn(
      [
        "bun",
        "--env-file=/home/ahmed/repos/gitdiagram/.env",
        "--conditions=react-server",
        "experiments/diagram-haiku/run.ts",
        slug,
        samples,
        arms,
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
      .filter((line) => /\tok |FAILED/.test(line))
      .join("\n");
    console.info(lines || `${slug}: ${errors.slice(-800)}`);
  }
};
await Promise.all([worker(), worker(), worker()]);
