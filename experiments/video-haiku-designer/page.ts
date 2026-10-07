/**
 * out/index.html: the contact sheets side by side per repository and run,
 * labelled by the same letters the judges saw, with the key at the bottom.
 *
 *   bun experiments/video-haiku-designer/page.ts
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OUT, REPOS, RUNS, slugOf } from "./lib";

const judge = JSON.parse(
  await readFile(join(OUT, "judge.json"), "utf8"),
) as Record<string, { key: Record<string, string> }>;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
let body = "";
let keys = "";
for (const repo of REPOS)
  for (const run of RUNS) {
    const entry = judge[`${repo}#r${run}`];
    if (!entry) continue;
    const script = JSON.parse(
      await readFile(join(OUT, "scripts", `${slugOf(repo)}.json`), "utf8"),
    ).script as { beats: Array<{ narration: string; brief: string }> };
    body += `<section><h2>${esc(repo)} <small>run ${run}</small></h2>
<details><summary>The shared script and briefs (${script.beats.length} beats)</summary><ol start="0">${script.beats
      .map(
        (b) =>
          `<li><b>${esc(b.narration)}</b><br><span>${esc(b.brief)}</span></li>`,
      )
      .join("")}</ol></details>
<div class="grid">${Object.keys(entry.key)
      .sort()
      .map((letter) => {
        const src = `films/${slugOf(repo)}/${entry.key[letter]}-r${run}/sheet.jpg`;
        return `<figure><figcaption>Film ${letter}</figcaption><a href="${src}" target="_blank"><img loading="lazy" src="${src}" alt="Film ${letter}"></a></figure>`;
      })
      .join("")}</div></section>`;
    keys += `<tr><td>${esc(repo)}</td><td>${run}</td>${Object.keys(entry.key)
      .sort()
      .map((l) => `<td>${l} = ${entry.key[l]}</td>`)
      .join("")}</tr>`;
  }
await writeFile(
  join(OUT, "index.html"),
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scene designer: GPT-6.1 Sol vs Claude Haiku 5.5</title>
<style>
body{font:15px/1.45 system-ui,sans-serif;margin:24px;background:#111;color:#eee}
h1{font-size:22px}h2{font-size:18px;margin:36px 0 8px}small{color:#999;font-weight:400}
p,li span,summary{color:#bbb}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
@media(max-width:900px){.grid{grid-template-columns:1fr}}
figure{margin:0}figcaption{font-weight:700;font-size:17px;margin:0 0 4px}
img{width:100%;display:block;border:1px solid #333;border-radius:6px}
details{margin:6px 0 12px}li{margin:4px 0}
.key{margin-top:60px;border-top:1px solid #444;padding-top:16px}table{border-collapse:collapse}
td{border:1px solid #444;padding:4px 10px}
</style>
<h1>Scene designer blind test: which film would you ship?</h1>
<p>Each block is one repository and one run. All four films in a block were designed from the same Opus 5.5 script; only the scene designer differs. One frame per beat, in order, left to right, top to bottom (click a sheet for full size). There is no narration audio: beat timing is a stand-in. The letters are the ones the two judges saw. The key is at the bottom of the page.</p>
${body}
<div class="key"><h2>Key</h2><p>Haiku films are shown with scenes that arrived as a JSON string parsed (a code fix production does not have yet).</p><table>${keys}</table></div>`,
);
console.info(join(OUT, "index.html"));
