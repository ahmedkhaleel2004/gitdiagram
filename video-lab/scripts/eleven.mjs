#!/usr/bin/env node
// ElevenLabs helper for the video lab.
//
//   node eleven.mjs credits
//   node eleven.mjs tts   --script narration.txt --out-dir assets/audio [--voice ID] [--model eleven_v3]
//   node eleven.mjs sfx   --prompt "soft ui tick" --seconds 0.6 --out assets/sfx/tick.mp3 [--influence 0.5]
//   node eleven.mjs music --prompt "..." --ms 65000 --out assets/audio/bed.mp3
//
// Narration scripts may contain cue markers written as {#cue-name}. Markers are
// stripped before synthesis; each resolves to the start time of the first
// spoken character after it, written to cues.json. Visual beats key off cues,
// so re-voicing the script re-times the whole video automatically.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const API = "https://api.elevenlabs.io";

function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const envFile = join(process.env.HOME, "repos/noorbot/.env");
  const line = readFileSync(envFile, "utf8")
    .split("\n")
    .find((l) => l.startsWith("ELEVENLABS_API_KEY="));
  if (!line) throw new Error("ELEVENLABS_API_KEY not found");
  return line.slice("ELEVENLABS_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
}

const KEY = loadKey();

function args() {
  const out = { _: [] };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

async function api(path, body, { json = true } = {}) {
  // Starter plans allow 4 concurrent requests; back off on 429 instead of failing.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}${path}`, {
      method: body ? "POST" : "GET",
      headers: { "xi-api-key": KEY, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 6) {
      await new Promise((r) => setTimeout(r, 1500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) {
      throw new Error(`${path} → ${res.status}: ${(await res.text()).slice(0, 600)}`);
    }
    return { res, data: json ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  }
}

async function credits() {
  const { data } = await api("/v1/user/subscription");
  return { used: data.character_count, limit: data.character_limit, tier: data.tier };
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

// Strip {#cue} markers, remembering the clean-text offset each one points at.
function parseCues(raw) {
  const cues = [];
  let clean = "";
  const re = /\{#([a-z0-9-]+)\}/gi;
  let last = 0;
  for (const m of raw.matchAll(re)) {
    clean += raw.slice(last, m.index);
    cues.push({ name: m[1], offset: clean.length });
    last = m.index + m[0].length;
  }
  clean += raw.slice(last);
  // Collapse whitespace the markers may have left behind.
  return { text: clean, cues };
}

function wordsFromAlignment(al) {
  const words = [];
  let cur = null;
  al.characters.forEach((ch, i) => {
    const s = al.character_start_times_seconds[i];
    const e = al.character_end_times_seconds[i];
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
      return;
    }
    if (!cur) cur = { text: "", start: s, end: e, charStart: i };
    cur.text += ch;
    cur.end = e;
  });
  if (cur) words.push(cur);
  return words;
}

async function tts(a) {
  const raw = readFileSync(a.script, "utf8").trim();
  const { text, cues } = parseCues(raw);
  const voice = a.voice || "iP95p4xoKVk53GoZ742B"; // Chris — charming, down-to-earth
  const model = a.model || "eleven_v3";
  const body = {
    text,
    model_id: model,
    voice_settings: {
      stability: Number(a.stability ?? 0.5),
      similarity_boost: Number(a.similarity ?? 0.8),
      style: Number(a.style ?? 0),
      use_speaker_boost: true,
      ...(a.speed ? { speed: Number(a.speed) } : {}),
    },
    ...(a.seed ? { seed: Number(a.seed) } : {}),
  };
  const before = await credits();
  const t0 = Date.now();
  const { res, data } = await api(
    `/v1/text-to-speech/${voice}/with-timestamps?output_format=mp3_44100_128`,
    body,
  );
  const ms = Date.now() - t0;
  const after = await credits();
  ensureDir(a["out-dir"]);
  const mp3 = join(a["out-dir"], "narration.mp3");
  writeFileSync(mp3, Buffer.from(data.audio_base64, "base64"));
  const al = data.alignment;
  // Tagged v3 text ([pause], [curious]) is not spoken; alignment still indexes
  // the original text, so cue offsets map directly onto it.
  const cueTimes = {};
  for (const c of cues) {
    let i = c.offset;
    while (i < al.characters.length && /[\s,.;:—-]/.test(al.characters[i])) i++;
    cueTimes[c.name] = Number((al.character_start_times_seconds[i] ?? 0).toFixed(3));
  }
  const words = wordsFromAlignment(al);
  const duration = al.character_end_times_seconds.at(-1);
  writeFileSync(join(a["out-dir"], "alignment.json"), JSON.stringify(al));
  writeFileSync(join(a["out-dir"], "words.json"), JSON.stringify(words, null, 1));
  writeFileSync(join(a["out-dir"], "cues.json"), JSON.stringify(cueTimes, null, 2));
  const meta = {
    voice,
    model,
    chars: text.length,
    words: words.length,
    speech_seconds: duration,
    wps: Number((words.length / duration).toFixed(2)),
    api_ms: ms,
    credits_used: after.used - before.used,
    request_id: res.headers.get("request-id"),
  };
  writeFileSync(join(a["out-dir"], "tts-meta.json"), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(cueTimes, null, 2));
}

async function sfx(a) {
  const t0 = Date.now();
  const { data } = await api(
    "/v1/sound-generation?output_format=mp3_44100_192",
    {
      text: a.prompt,
      ...(a.seconds ? { duration_seconds: Number(a.seconds) } : {}),
      prompt_influence: Number(a.influence ?? 0.5),
      model_id: "eleven_text_to_sound_v2",
    },
    { json: false },
  );
  const ms = Date.now() - t0;
  ensureDir(dirname(a.out));
  writeFileSync(a.out, data);
  console.log(JSON.stringify({ out: a.out, api_ms: ms }));
}

async function music(a) {
  const before = await credits();
  const t0 = Date.now();
  const { data } = await api(
    "/v1/music?output_format=mp3_44100_192",
    {
      prompt: a.prompt,
      music_length_ms: Number(a.ms),
      model_id: a.model || "music_v2",
      force_instrumental: true,
    },
    { json: false },
  );
  const ms = Date.now() - t0;
  const after = await credits();
  ensureDir(dirname(a.out));
  writeFileSync(a.out, data);
  console.log(JSON.stringify({ out: a.out, api_ms: ms, credits_used: after.used - before.used }));
}

const a = args();
const cmd = a._[0];
const run = { credits: async () => console.log(await credits()), tts, sfx, music }[cmd];
if (!run) {
  console.error("usage: eleven.mjs credits|tts|sfx|music …");
  process.exit(1);
}
await run(a);
