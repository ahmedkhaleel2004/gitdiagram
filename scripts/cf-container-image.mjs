#!/usr/bin/env node
// The render containers' image, named after what goes into it.
//
// Every deploy used to build the image afresh, and a fresh build is a new
// image even when nothing in it changed, so every push to main replaced the
// running containers (and the next render waited for the new image to be
// pulled). Here the image's tag is a hash of the files the containers run:
// the three container routes and everything they import, the video engine,
// and the build's own inputs. A deploy that changes none of them finds the
// image already in the registry, points at the same reference, and Cloudflare
// starts no rollout; one that does change them builds and pushes it once.
//
//   node scripts/cf-container-image.mjs --tag    print the tag for this tree
//   node scripts/cf-container-image.mjs          build and push if the registry lacks it; print the reference
//   node scripts/cf-container-image.mjs --config <out> [--from wrangler.jsonc]
//                                                the same, and write a wrangler config that uses the reference
//
// Needs Docker for a build, and CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY = "gitdiagram-site";
const ACCOUNT =
  process.env.CLOUDFLARE_ACCOUNT_ID ?? "8a4f309f2639721dc9f4f0d1790fd6d5";

/** Every file under `path` (relative to the repo), tests left out. */
function filesUnder(path) {
  const full = join(root, path);
  if (!statSync(full, { throwIfNoEntry: false })) return [];
  if (statSync(full).isFile()) return [path];
  return readdirSync(full, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !/\.test\.tsx?$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name).slice(root.length + 1));
}

/** The source files the container routes run: their whole import graph. */
async function routeSources() {
  const entryPoints = [
    ...filesUnder("src/app/api/video").filter((file) =>
      file.endsWith("/route.ts"),
    ),
    "src/proxy.ts",
    "src/instrumentation.ts",
  ];
  const result = await build({
    absWorkingDir: root,
    entryPoints,
    bundle: true,
    write: false,
    metafile: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outdir: "out",
    logLevel: "silent",
    loader: { ".css": "empty", ".svg": "empty" },
  });
  return Object.keys(result.metafile.inputs).filter(
    (file) => !file.includes("node_modules"),
  );
}

async function imageTag() {
  const files = [
    ...(await routeSources()),
    // What Chromium loads to draw a film, and the sounds mixed into it.
    ...filesUnder("public/video-engine"),
    // What the image is built from and with.
    ...[
      "Dockerfile",
      ".dockerignore",
      "package.json",
      "bun.lock",
      "next.config.js",
      "tsconfig.json",
      "patches",
    ].flatMap(filesUnder),
  ];
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    hash.update(file);
    hash.update("\0");
    hash.update(readFileSync(join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 16);
}

const wrangler = (args, options = {}) =>
  spawnSync("bunx", ["wrangler", ...args], {
    cwd: root,
    encoding: "utf8",
    ...options,
  });

function inRegistry(tag) {
  const listed = wrangler(["containers", "images", "list"]);
  if (listed.status !== 0)
    throw new Error(`Could not list registry images: ${listed.stderr}`);
  return listed.stdout
    .split("\n")
    .some((line) => new RegExp(`^${REPOSITORY}\\s+${tag}\\s*$`).test(line));
}

/** The image's registry reference, built and pushed first if it is new. */
async function ensureImage() {
  const tag = await imageTag();
  const reference = `registry.cloudflare.com/${ACCOUNT}/${REPOSITORY}:${tag}`;
  if (inRegistry(tag)) {
    console.error(
      `container image ${tag}: already in the registry, no rollout`,
    );
    return reference;
  }
  console.error(`container image ${tag}: building and pushing`);
  const built = wrangler(
    ["containers", "build", "-p", "-t", `${REPOSITORY}:${tag}`, "."],
    { stdio: ["ignore", 2, 2] },
  );
  if (built.status !== 0) throw new Error("The container image build failed.");
  return reference;
}

/** wrangler.jsonc as an object: comments and trailing commas removed. */
function readJsonc(path) {
  const text = readFileSync(path, "utf8").replace(
    /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_, string) => string ?? "",
  );
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
}

const args = process.argv.slice(2);
const option = (name) => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

if (args.includes("--tag")) {
  console.log(await imageTag());
} else {
  const reference = await ensureImage();
  const out = option("--config");
  if (out) {
    const config = readJsonc(join(root, option("--from") ?? "wrangler.jsonc"));
    for (const container of config.containers ?? [])
      container.image = reference;
    config.vars = {
      ...config.vars,
      // The Worker starts each container once after a new image, so no
      // visitor waits for it to be pulled (workers/render/src/container.ts).
      RENDER_IMAGE: reference.split(":").pop(),
    };
    writeFileSync(join(root, out), `${JSON.stringify(config, null, 2)}\n`);
    console.error(`wrote ${out}`);
  }
  console.log(reference);
}
