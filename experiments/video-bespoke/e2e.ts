/**
 * One film through the production pipeline (standard planner, README pictures,
 * local storage), for checking the whole path before shipping.
 *
 *   VIDEO_STORE=local bun --conditions=react-server experiments/video-bespoke/e2e.ts owner/repo
 */
import { standardPlanner } from "~/server/explainer/director";
import { generateExplainerVideo } from "~/server/explainer/generate";

const [username, repo] = (process.argv[2] ?? "").split("/") as [string, string];
const artifact = await generateExplainerVideo({
  username,
  repo,
  onEvent: (event) => {
    if (event.status !== "complete")
      console.info(JSON.stringify(event).slice(0, 200));
  },
  choosePlanner: async () => standardPlanner(),
});
console.info(
  JSON.stringify(
    {
      model: artifact.stats.model,
      totalMs: artifact.stats.totalMs,
      costUsd: artifact.stats.plannerCostUsd,
      images: artifact.plan.images,
      warnings: artifact.stats.warnings,
    },
    null,
    2,
  ),
);
