// Prompt variants for the bespoke-video experiments, built from production's.
import { SHOT_SYSTEM, designerTask } from "~/server/explainer/shot-prompt";

const VISUAL_START = "## Visual direction (designer)";
const SHOT_LANGUAGE = "## Shot language";

export const ART_DIRECTION = `## Art direction (designer)
Each scene is a shot in a film, not a slide. Design it from scratch for this repository and commit to one composition:
- HERO: one large element fills most of the frame (the real command running in a terminal, the product's own picture, a code panel, a big number, a headline) with at most two small annotations.
- SPLIT: two large panels side by side that the narration connects or contrasts (request → response, code → what it produces, before → after).
- PATH: three or four large stations across the frame, joined by arrows, that the story's thread travels through.
- CLOSE-UP: one tall code or tree panel the camera walks through: focus on one line, then the next.
Vary the composition from scene to scene.

Scale: the film is often watched on a phone. Boxes at least 3.4 × 1.4, chips at least 0.75 tall, code and terminal panels at least 8 wide, text size "l" unless it is a caption to something bigger. Never more than five things on screen at once (arrows not counted): exit or dim what the story has left behind before adding more. Leave air between elements (at least 0.4 units).

The camera frames every beat for you: it opens close on a scene's first beat and widens as the scene builds. So a scene's first beat is one strong element, and later beats grow around it.

Motion carries the meaning: every beat visibly changes something on its cue word, and changing what is there (replace a value, highlight a line, type the next command, count, flow along an arrow, focus the camera, move the thread) beats adding one more box. Things appear on the word that names them.

Match the script's level. Opening scenes show the product in use (its real command and output, its interface, its own picture), never source code. The middle shows the parts and the path between them. Code appears only under the hood: at most three short code panels in the whole film, trimmed to three to nine lines, wide enough to read (7 units when lines pass 45 characters, 9 past 60). Show the real thing: real commands, requests, outputs, names; never generic icons standing in for content.`;

const PICTURES = `
Pictures: the README's pictures are attached above the repository material (img1, img2, …). One that shows this project itself (its logo, its interface, its output, its mascot) is the most specific thing a film can show: when the brief shows the product or the project's identity, put it on screen as an image element (src "img1", …) sized to its aspect ratio, instead of a mock-up. Never use a picture of a person, a sponsor, another project, a badge or a video thumbnail.`;

const THREAD = (thread: { kind: string; text: string }) => `
The thread: this film follows one object, drawn as a ${thread.kind} with the text "${thread.text}" and the id "thread". In any scene where the story is about that object, include it (same id, kind and text) where it serves your composition; it glides from its place in the previous scene into yours, so it reads as one object travelling through the film. Leave it out of scenes that are not about it.`;

const IMAGE_KIND = `- image: src (a picture id: img1, img2, …), fit "contain" | "cover", frame "card" | "none" (none for logos and mascots on the paper). Keep w/h close to the picture's aspect ratio. Min 3 × 2.
- svg:`;

export function artSystem(options: {
  art?: boolean;
  pictures?: boolean;
  thread?: { kind: string; text: string } | null;
}): string {
  const start = SHOT_SYSTEM.indexOf(VISUAL_START);
  const end = SHOT_SYSTEM.indexOf(SHOT_LANGUAGE);
  if (start < 0 || end < 0) throw new Error("SHOT_SYSTEM layout changed");
  let direction =
    options.art === false
      ? SHOT_SYSTEM.slice(start, end).trimEnd()
      : ART_DIRECTION;
  if (options.pictures) direction += `\n${PICTURES}`;
  if (options.thread) direction += `\n${THREAD(options.thread)}`;
  let language = SHOT_SYSTEM.slice(end);
  if (options.pictures) language = language.replace("- svg:", IMAGE_KIND);
  return `${SHOT_SYSTEM.slice(0, start)}${direction}\n\n${language}`;
}

export { designerTask };

// Round 3: pictures reach the director too, and designers make them big.
const DIRECTOR_PICTURES = `- Pictures: the README's pictures are attached above the repository material (img1, img2, …). If one shows this project itself (its interface, its output, its logo or mascot), it is the most specific thing the film can show: build the opening around it, and name it in the brief by id ("img2 fills the frame"). It may return once later, at a moment it pays off. Ignore pictures of people, sponsors, other projects, badges and video thumbnails.
- "outro":`;

const DESIGNER_PICTURES = `- Pictures: the README's pictures are attached above the repository material (img1, img2, …). Use one where the brief names it, or where the product itself belongs on screen, as an image element instead of a mock-up. A picture that is the subject is big: at least 8 units wide (a screenshot) or 5 (a logo or mascot), sized to its aspect ratio, with at most two small elements beside or over it. Never use a picture of a person, a sponsor, another project, a badge or a video thumbnail.
- Design each scene from scratch`;

export function pictureSystem(): string {
  const once = (s: string, a: string, b: string) => {
    if (s.split(a).length !== 2)
      throw new Error(`SHOT_SYSTEM layout changed: ${a}`);
    return s.replace(a, b);
  };
  let s = SHOT_SYSTEM;
  s = once(s, '- "outro":', DIRECTOR_PICTURES);
  s = once(s, "- Design each scene from scratch", DESIGNER_PICTURES);
  s = once(s, "- svg:", IMAGE_KIND);
  return s;
}
