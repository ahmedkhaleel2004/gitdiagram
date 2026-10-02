#!/usr/bin/env node
// A full copy of the site on Cloudflare for testing the video pipeline away
// from the live one: Workers `gitdiagram-staging` (cloudflare/staging.ts, the
// site's entry Worker plus operator-only hooks to stop and kill containers),
// `gitdiagram-staging-server` and `-server-local`, its own render containers,
// its own R2 bucket and Redis, Stripe in test mode.
//
//   node scripts/cf-staging.mjs config    write the three wrangler.staging*.jsonc
//   node scripts/cf-staging.mjs deploy    build, then deploy (needs Docker)
//   node scripts/cf-staging.mjs deploy --skip-build
//   node scripts/cf-staging.mjs destroy   delete the Worker and its containers
//
// Its settings come from STAGING_ENV_FILE (default
// ~/.config/gitdiagram/staging/env.json): the production names (see
// scripts/cf-secrets.mjs) with R2_*_BUCKET, UPSTASH_REDIS_REST_*,
// STRIPE_SECRET_KEY (sk_test_…) and CRON_SECRET pointing somewhere safe.
// The script refuses to deploy with the production bucket, Redis or a live
// Stripe key. Optional overrides for experiments: STAGING_RENDER_INSTANCE
// (JSON instance_type), STAGING_GENERATE_INSTANCE, STAGING_VARS (JSON).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "gitdiagram-staging";
const ACCOUNT = "8a4f309f2639721dc9f4f0d1790fd6d5";
const ORIGIN = `https://${NAME}.gitdiagram-presence.workers.dev`;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** wrangler.jsonc as an object: comments and trailing commas removed. */
function readJsonc(path) {
  const text = readFileSync(path, "utf8").replace(
    /("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_, string) => string ?? "",
  );
  return JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
}
const envFile =
  process.env.STAGING_ENV_FILE ??
  join(homedir(), ".config/gitdiagram/staging/env.json");
const productionFile = join(
  homedir(),
  ".config/gitdiagram/cloudflare/production.env.json",
);

const parse = (name) =>
  process.env[name] ? JSON.parse(process.env[name]) : undefined;

/** The live Workers' names, as staging's. */
const stagingName = (name) => name.replace(/^gitdiagram/, NAME);

const CONFIGS = {
  "wrangler.jsonc": "wrangler.staging.jsonc",
  "wrangler.server.jsonc": "wrangler.staging-server.jsonc",
  "wrangler.server-local.jsonc": "wrangler.staging-server-local.jsonc",
};

/**
 * One of the site's three Worker configs (the entry Worker and the two
 * servers behind it), turned into staging's: its own names, no routes, no
 * error Tail Worker, every log line kept, and bindings that point at staging's
 * Workers and bucket instead of the live ones.
 */
function stagingConfig(file) {
  const base = readJsonc(join(root, file));
  const front = file === "wrangler.jsonc";
  const rest = { ...base, name: stagingName(base.name) };
  delete rest.routes;
  delete rest.tail_consumers;
  const [render, generate] = base.containers ?? [];
  return {
    ...rest,
    ...(front ? { main: "cloudflare/staging.ts" } : {}),
    observability: { enabled: true, head_sampling_rate: 1 },
    vars: {
      ...base.vars,
      INDEXNOW_ENABLED: "",
      SITE_ORIGIN: ORIGIN,
      ...(front ? parse("STAGING_VARS") : {}),
    },
    services: base.services?.map((service) => ({
      ...service,
      service: stagingName(service.service),
    })),
    r2_buckets: base.r2_buckets?.map((bucket) => ({
      ...bucket,
      bucket_name: "gitdiagram-staging",
    })),
    durable_objects: base.durable_objects && {
      bindings: base.durable_objects.bindings.map((binding) => ({
        ...binding,
        ...(binding.script_name
          ? { script_name: stagingName(binding.script_name) }
          : {}),
      })),
    },
    ...(front
      ? {
          // The payments sweep, and the five-minute one that also warms new
          // container images (its own chore, the browse index, is harmless
          // here).
          triggers: { crons: ["*/5 * * * *", "*/15 * * * *"] },
          containers: [
            {
              ...render,
              instance_type:
                parse("STAGING_RENDER_INSTANCE") ?? render.instance_type,
            },
            {
              ...generate,
              instance_type:
                parse("STAGING_GENERATE_INSTANCE") ?? generate.instance_type,
            },
          ],
          // Counted apart from the live site's limits.
          ratelimits: base.ratelimits.map((limit) => ({
            ...limit,
            namespace_id: String(Number(limit.namespace_id) + 1000),
          })),
        }
      : {}),
  };
}

function checkedSecrets() {
  if (!existsSync(envFile))
    throw new Error(`No staging settings at ${envFile}`);
  const staging = JSON.parse(readFileSync(envFile, "utf8"));
  const production = existsSync(productionFile)
    ? JSON.parse(readFileSync(productionFile, "utf8"))
    : {};
  for (const name of [
    "R2_PUBLIC_BUCKET",
    "R2_PRIVATE_BUCKET",
    "UPSTASH_REDIS_REST_URL",
    "CRON_SECRET",
  ])
    if (!staging[name] || staging[name] === production[name])
      throw new Error(`${name} must be set and differ from production's.`);
  if (staging.STRIPE_SECRET_KEY && !/^sk_test_/.test(staging.STRIPE_SECRET_KEY))
    throw new Error("STRIPE_SECRET_KEY must be a test-mode key (sk_test_…).");
  return staging;
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function wranglerEnv() {
  const tokenFile = join(homedir(), ".config/gitdiagram/cloudflare-api-token");
  const token =
    process.env.CLOUDFLARE_API_TOKEN ??
    (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "");
  return {
    CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
    ...(token
      ? {
          CLOUDFLARE_API_TOKEN: token,
          // See scripts/cf-deploy.sh: a stored login must not shadow the token.
          XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), "wrangler-")),
        }
      : {}),
  };
}

const [action, ...flags] = process.argv.slice(2);

if (action === "config" || action === "deploy") {
  for (const [file, out] of Object.entries(CONFIGS)) {
    writeFileSync(
      join(root, out),
      `${JSON.stringify(stagingConfig(file), null, 2)}\n`,
    );
    console.log(`wrote ${out}`);
  }
}
if (action === "deploy") {
  checkedSecrets();
  const [front, ...servers] = Object.values(CONFIGS);
  const skipBuild = flags.includes("--skip-build");
  const env = wranglerEnv();
  const exists = (config) =>
    spawnSync("bunx", ["wrangler", "deployments", "status", "-c", config], {
      cwd: root,
      env: { ...process.env, ...env },
    }).status === 0;
  if (!exists(servers[0])) {
    // The very first deploy. The servers bind Durable Objects the entry
    // Worker exports, and the entry Worker binds the servers, so neither can
    // go first as it is: the entry Worker goes up once without its two
    // server bindings.
    if (!skipBuild)
      run("bash", ["scripts/cf-build.sh"], { CF_ENV_FILE: envFile });
    const bootstrap = "wrangler.staging-bootstrap.jsonc";
    const config = stagingConfig("wrangler.jsonc");
    config.services = config.services.filter(
      (service) => !/-server/.test(service.service),
    );
    writeFileSync(join(root, bootstrap), JSON.stringify(config, null, 2));
    run(
      "node",
      [
        "scripts/cf-container-image.mjs",
        "--from",
        bootstrap,
        "--config",
        bootstrap,
      ],
      env,
    );
    run("bunx", ["wrangler", "deploy", "-c", bootstrap], {
      ...env,
      OPEN_NEXT_DEPLOY: "true",
    });
    flags.push("--skip-build");
  }
  // The live site's own deploy script, pointed at staging's three configs
  // and settings: the same build, the same content-named container image,
  // the same order (servers staged, then the entry Worker).
  run(
    "bash",
    [
      "scripts/cf-deploy.sh",
      "--secrets",
      ...(flags.includes("--skip-build") ? ["--skip-build"] : []),
    ],
    {
      CF_ENV_FILE: envFile,
      CF_FRONT_CONFIG: front,
      CF_SERVER_CONFIGS: servers.join(" "),
      CF_SKIP_CACHE_POPULATE: "1",
    },
  );
  console.log(`deployed ${ORIGIN}`);
} else if (action === "destroy") {
  const env = wranglerEnv();
  // The entry Worker first: the servers are bound to it and it to them.
  for (const config of Object.values(CONFIGS))
    run("bunx", ["wrangler", "delete", "-c", config, "--force"], env);
  console.log(
    "Workers deleted. Check `bunx wrangler containers list` for leftover container applications.",
  );
} else if (action !== "config") {
  console.error("usage: node scripts/cf-staging.mjs config|deploy|destroy");
  process.exit(1);
}
