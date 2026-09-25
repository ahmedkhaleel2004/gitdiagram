import { flag } from "./format";
import type { LiveFeedEvent } from "./types";

// How the live feed on /admin reads each event the site sends
// (src/server/admin/live-events.ts), in plain words.

/** Why a visitor could not make a video. */
const HELD_BACK: Record<string, string> = {
  mobile: "On a phone or tablet",
  place: "Outside the priority places",
  audience: "Not in early access",
  paused: "Videos are paused",
  daily: "Today's video limit is used up",
  person: "They already made today's video",
  network: "Their connection hit its daily backstop",
  voice: "Today's voice quota is used up",
};

const FAILED = "text-red-700 dark:text-red-400";
const DONE = "text-green-700 dark:text-green-400";

export interface EventLine {
  title: string;
  /** Text colour classes. */
  tone: string;
  detail: string;
}

const joined = (parts: unknown[]) => parts.filter(Boolean).join(" · ");

export function describeEvent(event: LiveFeedEvent): EventLine {
  const where = [event.city, event.region, event.country]
    .filter((part) => typeof part === "string" && part)
    .join(", ");
  const place = where ? `${flag(String(event.country ?? ""))} ${where}` : "";
  const seconds =
    typeof event.ms === "number" ? `${(event.ms / 1000).toFixed(1)}s` : "";
  const cost =
    typeof event.costUsd === "number" ? `$${event.costUsd.toFixed(3)}` : "";
  const outcome = String(event.outcome ?? "");
  const failed = outcome === "error";
  switch (event.kind) {
    case "diagram.started":
      return {
        title: "Diagram started",
        tone: "text-sky-700 dark:text-sky-300",
        detail: joined([place, event.ownKey ? "own key" : ""]),
      };
    case "diagram.finished":
      return {
        title:
          outcome === "complete"
            ? "Diagram made"
            : outcome === "cancelled"
              ? "Diagram cancelled"
              : "Diagram failed",
        tone: failed ? FAILED : DONE,
        detail: joined([
          seconds,
          cost,
          failed ? String(event.errorCode ?? "") : "",
        ]),
      };
    case "video.started":
      return {
        title: "Video started",
        tone: "text-purple-700 dark:text-purple-300",
        detail: joined([place, event.operator ? "you" : ""]),
      };
    case "video.finished":
      return {
        title: failed ? "Video failed" : "Video made",
        tone: failed ? FAILED : DONE,
        detail: seconds,
      };
    case "video.gated":
      return {
        title: "Video held back",
        tone: "text-amber-700 dark:text-amber-300",
        detail: joined([
          HELD_BACK[String(event.reason)] ?? String(event.reason ?? ""),
          event.step === "start" ? "after pressing Make the video" : "",
          place,
          String(event.device ?? ""),
        ]),
      };
    case "render.started":
      return {
        title: "MP4 started",
        tone: "text-purple-700 dark:text-purple-300",
        detail: String(event.format ?? ""),
      };
    case "render.finished":
      return {
        title: failed ? "MP4 failed" : "MP4 made",
        tone: failed ? FAILED : DONE,
        detail: joined([String(event.format ?? ""), seconds]),
      };
    case "limits.reset":
      return {
        title: "Count reset",
        tone: "text-[hsl(var(--foreground))]",
        // `cleared`: how many the public had started today before the reset.
        detail: `Today's ${event.target === "renders" ? "MP4s" : "videos"} started over. ${String(event.cleared ?? 0)} were used today before the reset.`,
      };
    case "control.changed":
      return {
        title: "Setting changed",
        tone: "text-[hsl(var(--foreground))]",
        detail: JSON.stringify(event.changes ?? {})
          .replace(/[{}"]/g, "")
          .replace(/,/g, ", "),
      };
    case "admin.signed_in":
      return { title: "You signed in", tone: "", detail: place };
    case "admin.signed_out_everywhere":
      return { title: "Signed out everywhere", tone: "", detail: place };
    case "admin.sign_in_failed":
      return { title: "Failed sign-in", tone: FAILED, detail: place };
    default:
      return { title: event.kind, tone: "", detail: String(event.note ?? "") };
  }
}

/** Events that move a counter the dashboard polls, so it re-reads at once. */
export function movesCounters(kind: string): boolean {
  return /^(video|render|diagram\.finished|control|limits)/.test(kind);
}

/** The live feed's filters beyond "All". */
export type FeedTopic = "diagrams" | "videos";

/**
 * Which filter shows an event: diagrams, or videos with their MP4s and
 * count resets. Sign-ins and setting changes only show under "All".
 */
export function eventTopic(kind: string): FeedTopic | null {
  if (kind.startsWith("diagram.")) return "diagrams";
  if (/^(video|render|limits)\./.test(kind)) return "videos";
  return null;
}
