/**
 * One film through the production pipeline (standard planner, README pictures,
 * local storage), for checking the whole path before shipping.
 *
 *   VIDEO_STORE=local bun --conditions=react-server experiments/video-bespoke/e2e.ts owner/repo
 */
import { generateExplainerVideo } from "~/server/explainer/generate";
import { choosePlanner } from "~/server/explainer/planner";

const [username, repo] = (process.argv[2] ?? "").split("/") as [string, string];
const artifact = await generateExplainerVideo({
  username,
  repo,
  onEvent: (event) => {
    if (event.status !== "complete")
      console.info(JSON.stringify(event).slice(0, 200));
  },
  // A small repository and an ordinary visitor: the standard planner.
  choosePlanner: async () =>
    (
      await choosePlanner({
        operator: false,
        stars: 0,
        priority: false,
        takePremium: async () => null,
      })
    ).planner,
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
