/**
 * Rebuild each film's "fixed" artifact from the saved raw replies: every
 * scene's shots are kept whether `shots` came as an array or as a JSON string
 * (strictly parsed, or leniently up to the array's last bracket). This is what
 * a tolerant parse in director.ts would give; artifact-as-is.json stays what
 * production's code keeps today. Also right when the as-is design threw (then
 * run.ts had no shots at all to start from).
 *
 *   bun --conditions=react-server experiments/video-haiku-designer/rebuild.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { VideoArtifact } from "~/features/explainer/types";
import type { Script } from "~/server/explainer/script";
import { normalizeShots } from "~/server/explainer/shots";
import { OUT, REPOS, RUNS, SETUPS, SETUP_NAMES, runDir, slugOf } from "./lib";

const json = async (path: string) => JSON.parse(await readFile(path, "utf8"));

for (const repo of REPOS) {
  const repository = await json(join(OUT, "repos", `${slugOf(repo)}.json`));
  const script = (await json(join(OUT, "scripts", `${slugOf(repo)}.json`)))
    .script as Script;
  for (const setup of SETUP_NAMES)
    for (const run of RUNS) {
      const dir = runDir(repo, setup, run);
      const report = await json(join(dir, "report.json")).catch(() => null);
      if (!report) continue;
      const raws = (await json(join(dir, "raw-calls.json"))) as Array<
        Record<string, any>
      >;
      const shotsByBeat = new Map<number, Record<string, unknown>>();
      const scenes = { array: 0, string: 0, lenient: 0, broken: 0, none: 0 };
      for (const raw of raws) {
        // Only the designer's own replies (a second model stepping in counts too).
        const assigned = (
          /Design exactly the beats ([\d, ]+) and/.exec(raw.task ?? "")?.[1] ??
          ""
        )
          .split(",")
          .map((n: string) => Number(n.trim()));
        if (!raw.task?.includes("Design exactly the beats")) continue;
        let input: any = raw.content?.find(
          (b: any) => b.type === "tool_use",
        )?.input;
        if (!input) {
          const call = raw.output?.find((i: any) => i.type === "function_call");
          try {
            input = call ? JSON.parse(call.arguments) : undefined;
          } catch {
            input = undefined;
          }
        }
        let shots: unknown = input?.shots;
        if (Array.isArray(shots)) scenes.array++;
        else if (typeof shots === "string") {
          scenes.string++;
          const text = shots;
          try {
            shots = JSON.parse(text);
          } catch {
            try {
              shots = JSON.parse(text.slice(0, text.lastIndexOf("]") + 1));
              scenes.lenient++;
            } catch {
              scenes.broken++;
            }
          }
        } else scenes.none++;
        if (Array.isArray(shots))
          for (const shot of shots) {
            const beat = Number(shot?.beat);
            if (assigned.includes(beat)) shotsByBeat.set(beat, shot);
          }
      }
      const { plan, warnings } = normalizeShots(
        script,
        shotsByBeat,
        repository.facts,
      );
      const shown = new Set(
        plan.beats.flatMap((b) =>
          b.elements.flatMap((e) =>
            e.kind === "image" ? [String(e.src)] : [],
          ),
        ),
      );
      const pictures = repository.pictures.filter((p: any) => shown.has(p.id));
      if (pictures.length)
        plan.images = Object.fromEntries(
          pictures.map((p: any) => [
            p.id,
            `/exp-images/${slugOf(repo)}/${p.id}.${p.mediaType.split("/")[1]}`,
          ]),
        );
      const old = (await json(join(dir, "artifact.json"))) as VideoArtifact;
      const artifact: VideoArtifact = {
        ...old,
        plan,
        stats: { ...old.stats, warnings },
      };
      await writeFile(join(dir, "artifact.json"), JSON.stringify(artifact));
      Object.assign(report, {
        beatsDesigned: shotsByBeat.size,
        warnings,
        replyShapes: scenes,
        picturesShown: pictures.length,
        elements: plan.beats.reduce((n, b) => n + b.elements.length, 0),
        actions: plan.beats.reduce((n, b) => n + b.actions.length, 0),
      });
      await writeFile(
        join(dir, "report.json"),
        JSON.stringify(report, null, 2),
      );
      console.info(
        `${repo} ${setup} r${run}: fixed ${shotsByBeat.size}/${script.beats.length} beats (as-is ${report.beatsDesignedAsIs}), replies ${JSON.stringify(scenes)}, ${warnings.length} warnings`,
      );
    }
}
void SETUPS;
