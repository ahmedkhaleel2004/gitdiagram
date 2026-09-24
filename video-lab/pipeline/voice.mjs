// Voice every beat in parallel (ElevenLabs allows 4 concurrent requests on Starter),
// then lay the clips on one clock: each beat's words get absolute times.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.elevenlabs.io";
const KEY =
  process.env.ELEVENLABS_API_KEY ||
  (readFileSync(join(process.env.HOME, "repos/noorbot/.env"), "utf8").match(/^ELEVENLABS_API_KEY=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, "");

export const normWord = (w) => w.toLowerCase().replace(/[^a-z0-9.#/]/g, "").replace(/\.$/, "");

async function tts(text, o) {
  const body = {
    text,
    model_id: o.model,
    voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0, use_speaker_boost: true },
    seed: o.seed,
    // eleven_v3 rejects continuity hints; older models use them to keep prosody across clips.
    ...(o.previous && o.model !== "eleven_v3" ? { previous_text: o.previous } : {}),
    ...(o.next && o.model !== "eleven_v3" ? { next_text: o.next } : {}),
  };
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/v1/text-to-speech/${o.voice}/with-timestamps?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": KEY, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 6) {
      await new Promise((r) => setTimeout(r, 1200 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
}

function words(al) {
  const out = [];
  let cur = null;
  al.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = null;
      return;
    }
    if (!cur) cur = { text: "", s: al.character_start_times_seconds[i], e: 0 };
    cur.text += ch;
    cur.e = al.character_end_times_seconds[i];
  });
  if (cur) out.push(cur);
  return out;
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const k = next++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

export async function voice(spec, dir, o = {}) {
  const opts = { voice: "iP95p4xoKVk53GoZ742B", model: "eleven_v3", seed: 7, tempo: 1.06, lead: 0.6, tail: 3.8, ...o };
  const t0 = Date.now();
  mkdirSync(join(dir, "assets/voice"), { recursive: true });
  const beats = spec.beats;
  let chars = 0;
  const clips = await pool(beats, 4, async (b, k) => {
    const r = await tts(b.narration, {
      ...opts,
      previous: beats[k - 1]?.narration,
      next: beats[k + 1]?.narration,
    });
    chars += b.narration.length;
    const file = `assets/voice/beat-${String(k).padStart(2, "0")}.mp3`;
    writeFileSync(join(dir, file), Buffer.from(r.audio_base64, "base64"));
    const ws = words(r.alignment);
    return { file, ws, end: r.alignment.character_end_times_seconds.at(-1) };
  });

  // Pauses carry structure: a little longer between chapters and around the big idea.
  const tempo = opts.tempo;
  let cursor = opts.lead;
  const timing = [];
  const voices = [];
  beats.forEach((b, k) => {
    const c = clips[k];
    const start = cursor;
    voices.push({ file: c.file, start });
    const w = c.ws.map((x) => ({ w: normWord(x.text), s: +(start + x.s / tempo).toFixed(3), e: +(start + x.e / tempo).toFixed(3) }));
    const end = start + c.end / tempo;
    timing.push({ start: +start.toFixed(3), end: +end.toFixed(3), words: w });
    const nb = beats[k + 1];
    let gap = 0.34;
    if (nb && nb.chapter !== b.chapter) gap += 0.16;
    if (nb && (nb.scene.type === "idea" || b.scene.type === "idea")) gap += 0.3;
    if (nb && nb.scene.type === "close") gap += 0.25;
    cursor = end + gap;
  });
  const speechEnd = timing.at(-1).end;
  const DURATION = Math.ceil((speechEnd + opts.tail) * 10) / 10;
  return {
    timing: { DURATION, SPEECH_END: speechEnd, beats: timing },
    voices,
    tempo,
    chars,
    ms: Date.now() - t0,
  };
}
