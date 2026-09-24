// Fetch everything the planner needs to understand a repository, in parallel:
// metadata, the recursive tree, the README, and a scored sample of source files.
import { execFileSync } from "node:child_process";

const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|kts|rb|php|cs|swift|c|h|cc|cpp|hpp|scala|ex|exs|clj|lua|zig|dart|vue|svelte|sol|ml|hs|erl|jl|r|sh)$/i;
const MANIFESTS = [
  "package.json",
  "pyproject.toml",
  "setup.py",
  "go.mod",
  "Cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
  "composer.json",
  "mix.exs",
  "Package.swift",
  "deno.json",
];
const NOISE =
  /(^|\/)(node_modules|vendor|third_party|dist|build|out|target|coverage|\.git|\.github|\.vscode|\.idea|__pycache__|\.next|fixtures?|testdata|__snapshots__|snapshots|migrations|locales?|i18n|assets|static|public|docs?|examples?|benchmarks?|bench)(\/|$)/i;
const TESTS = /(^|\/)(tests?|test-d|__tests__|spec|specs|e2e|testing)(\/|$)|[._-](test|spec|bench)\.[a-z]+$|_test\.go$|(^|\/)test_[^/]+\.py$|(^|\/)conftest\.py$/i;
// Folders that hold teaching or tooling code rather than the project itself.
const SIDE = /(^|\/)(docs?_?src|examples?|samples?|tutorials?|demos?|scripts?|tools|playground|website|site|contrib|hack|bench(marks?)?)(\/|$)/i;
const DECL =
  /^\s{0,4}(export\s+(default\s+)?|pub(\(crate\))?\s+|public\s+|private\s+|protected\s+|static\s+|async\s+|abstract\s+)*(def|class|func|fn|function|interface|type|struct|enum|trait|impl|module|mod|const|let)\b/;
const JUNK = /\.(min\.js|map|lock|snap|d\.ts)$|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/i;
const ENTRY =
  /(^|\/)(main|index|app|server|cli|lib|mod|core|__init__|__main__|router|routes|api|handler|client|engine|runtime|compiler|parser|config|cmd)\.[a-z]+$/i;
const SRC_DIR = /(^|\/)(src|lib|pkg|core|cmd|internal|app|server|packages\/[^/]+\/src)\//i;

let token = process.env.GITHUB_TOKEN || "";
if (!token) {
  try {
    token = execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {}
}

async function gh(path, accept = "application/vnd.github+json") {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { accept, ...(token ? { authorization: `Bearer ${token}` } : {}), "x-github-api-version": "2022-11-28" },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}`);
  return accept.includes("raw") ? res.text() : res.json();
}

async function raw(owner, repo, ref, path) {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const res = await fetch(url, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error(`raw ${path} → ${res.status}`);
  return res.text();
}

export function parseRepo(input) {
  const m = String(input)
    .trim()
    .replace(/\.git$/, "")
    .match(/(?:github\.com[/:])?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/);
  if (!m) throw new Error(`not a GitHub repo: ${input}`);
  return { owner: m[1], repo: m[2] };
}

const eligible = (path) => CODE_EXT.test(path) && !NOISE.test(path) && !TESTS.test(path) && !JUNK.test(path) && !SIDE.test(path);
const topSeg = (path) => (path.includes("/") ? path.split("/")[0] : "");

function scoreFile(path, size, ctx) {
  if (!eligible(path)) return -1;
  const depth = path.split("/").length - 1;
  const base = path.split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
  let s = 0;
  if (ctx.primary.has(topSeg(path))) s += 6;
  if (ENTRY.test(path)) s += 4;
  if (SRC_DIR.test(path)) s += 2;
  s += Math.max(0, 3 - depth);
  // Bigger files inside the project are usually the central ones; we only send an outline.
  if (size > 1000) s += Math.min(4, Math.log2(size / 1000));
  if (size < 300) s -= 4;
  const name = ctx.repo.toLowerCase();
  if (base.length >= 3 && (name.includes(base) || base.includes(name))) s += 5;
  // Files the README talks about are usually the ones worth explaining.
  if (base.length > 3 && ctx.readme.includes(base)) s += 2;
  return s;
}

// Opening lines for flavor plus an outline of declarations for breadth.
function digest(text, cap) {
  if (text.length <= cap) return text;
  const head = text.slice(0, Math.floor(cap * 0.45));
  const outline = [];
  let used = 0;
  for (const line of text.slice(head.length).split("\n")) {
    if (!DECL.test(line)) continue;
    const l = line.length > 120 ? line.slice(0, 117) + "..." : line;
    if (used + l.length > cap * 0.55) break;
    outline.push(l);
    used += l.length + 1;
  }
  return `${head}\n… [${text.length} chars total; later declarations:]\n${outline.join("\n")}`;
}

export async function ingest(input, { maxFiles = 12, fileChars = 4000, totalChars = 44000, treeChars = 20000 } = {}) {
  const t0 = Date.now();
  const { owner, repo } = parseRepo(input);
  const meta = await gh(`/repos/${owner}/${repo}`);
  const ref = meta.default_branch;
  const [tree, readme, languages] = await Promise.all([
    gh(`/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`),
    gh(`/repos/${owner}/${repo}/readme`, "application/vnd.github.raw+json").catch(() => ""),
    gh(`/repos/${owner}/${repo}/languages`).catch(() => ({})),
  ]);
  const blobs = tree.tree.filter((e) => e.type === "blob");
  const paths = blobs.map((b) => b.path);

  // Pick source files: best score first, with a penalty for crowding one directory.
  // The primary source roots are the top-level folders holding the most project code.
  const bytes = {};
  for (const b of blobs) if (eligible(b.path)) bytes[topSeg(b.path)] = (bytes[topSeg(b.path)] || 0) + (b.size || 0);
  const ranked = Object.entries(bytes).sort((a, b) => b[1] - a[1]);
  const primary = new Set(ranked.filter(([, v], i) => i < 2 && v >= (ranked[0]?.[1] || 0) * 0.25).map(([k]) => k));
  const sctx = { primary, repo, readme: readme.toLowerCase() };
  const scored = blobs
    .map((b) => ({ path: b.path, size: b.size || 0, score: scoreFile(b.path, b.size || 0, sctx) }))
    .filter((f) => f.score >= 0)
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  const picked = [];
  const perDir = {};
  for (const f of scored) {
    if (picked.length >= maxFiles) break;
    const dir = f.path.split("/").slice(0, -1).join("/");
    if ((perDir[dir] || 0) >= (primary.has(dir) ? 6 : 3)) continue;
    perDir[dir] = (perDir[dir] || 0) + 1;
    picked.push(f);
  }
  const manifest = MANIFESTS.find((m) => paths.includes(m));
  const toFetch = [...(manifest ? [{ path: manifest }] : []), ...picked];
  const fetched = await Promise.all(
    toFetch.map((f) =>
      raw(owner, repo, ref, f.path)
        .then((text) => ({ path: f.path, text }))
        .catch(() => null),
    ),
  );
  let budget = totalChars;
  const files = [];
  for (const f of fetched) {
    if (!f || budget <= 0) continue;
    const cap = Math.min(f.path === manifest ? 2500 : fileChars, budget);
    const text = digest(f.text, cap);
    budget -= text.length;
    files.push({ path: f.path, text });
  }

  // Tree listing for the prompt: drop noise, keep it bounded.
  const listed = paths.filter((p) => !JUNK.test(p) && !/(^|\/)(node_modules|\.git)\//.test(p));
  let treeText = "";
  for (const p of listed) {
    if (treeText.length + p.length + 1 > treeChars) {
      treeText += `… (${listed.length} files total; listing truncated)\n`;
      break;
    }
    treeText += p + "\n";
  }

  return {
    owner,
    repo,
    ref,
    url: `https://github.com/${owner}/${repo}`,
    meta: {
      name: meta.name,
      description: meta.description || "",
      stars: meta.stargazers_count,
      forks: meta.forks_count,
      language: meta.language || Object.keys(languages)[0] || "",
      languages: Object.keys(languages).slice(0, 5),
      topics: meta.topics || [],
      license: meta.license?.spdx_id || "",
      homepage: meta.homepage || "",
    },
    readme: readme.length > 9000 ? readme.slice(0, 9000) + "\n… (truncated)" : readme,
    paths,
    treeText,
    treeTruncated: Boolean(tree.truncated),
    files,
    ms: Date.now() - t0,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ctx = await ingest(process.argv[2]);
  console.log(
    JSON.stringify(
      {
        repo: `${ctx.owner}/${ctx.repo}`,
        ms: ctx.ms,
        paths: ctx.paths.length,
        treeChars: ctx.treeText.length,
        readmeChars: ctx.readme.length,
        files: ctx.files.map((f) => `${f.path} (${f.text.length})`),
      },
      null,
      1,
    ),
  );
}
