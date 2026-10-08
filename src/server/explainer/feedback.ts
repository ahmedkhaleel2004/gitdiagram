import "server-only";

import { Resend } from "resend";

import { readAdmissionControls } from "~/server/admin/controls";
import { requestOrigin } from "~/server/admin/live-events";
import { SITE_URL } from "~/lib/site";
import { isInVideoRegion } from "./audience";
import { isVideoAdmin } from "./limits";

// Feedback on a video goes straight to the operator's inbox as a plain-text
// email through Resend (RESEND_API_KEY and RESEND_EMAIL_DOMAIN). Only people in the priority places
// see the button, the audience whose opinion matters most during early access.

interface FeedbackConfig {
  apiKey: string;
  from: string;
  to: string;
}

function feedbackConfig(): FeedbackConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const domain = process.env.RESEND_EMAIL_DOMAIN?.trim();
  const to = process.env.VIDEO_FEEDBACK_TO?.trim();
  if (!apiKey || !domain || !to) return null;
  return { apiKey, from: `GitDiagram <feedback@${domain}>`, to };
}

/**
 * Whether this visitor gets the feedback button: in a priority place, or the
 * operator (to see it), or anyone in local development. Never when email is
 * not set up, or when the switches cannot be read.
 */
export async function canSendFeedback(request: Request): Promise<boolean> {
  if (!feedbackConfig()) return false;
  if (process.env.NODE_ENV !== "production") return true;
  try {
    const { priorityPlaces } = await readAdmissionControls();
    return (
      isInVideoRegion(request, priorityPlaces) || (await isVideoAdmin(request))
    );
  } catch {
    return false;
  }
}

export interface VideoFeedback {
  owner: string;
  repo: string;
  message: string;
  /** Where to reply, if they left an address. */
  email?: string;
  /** How far into the film they were, in seconds. */
  at?: number;
  /** The film's length, in seconds. */
  duration: number;
  createdAt: string;
  model: string;
}

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** The email, in plain text: the message first, then where it came from. */
export function feedbackEmail(feedback: VideoFeedback, request: Request) {
  const { city, region, country, device } = requestOrigin(request);
  const place = [city, region, country].filter(Boolean).join(", ");
  const repository = `${feedback.owner}/${feedback.repo}`;
  const lines = [
    feedback.message,
    "",
    "—",
    `Video: ${SITE_URL}/${feedback.owner}/${feedback.repo}/video`,
    `Made ${feedback.createdAt} with ${feedback.model}`,
    feedback.at === undefined
      ? `Length ${clock(feedback.duration)}`
      : `Sent at ${clock(feedback.at)} of ${clock(feedback.duration)}`,
    `From: ${place || "unknown place"} · ${device}`,
    feedback.email
      ? `Reply to: ${feedback.email}`
      : "No email left, so replying goes nowhere.",
  ];
  const preview = feedback.message.replace(/\s+/g, " ").slice(0, 60);
  return {
    subject: `Video feedback on ${repository}: ${preview}${feedback.message.length > 60 ? "…" : ""}`,
    text: lines.join("\n"),
  };
}

/** Send it. Throws when email is not set up or Resend refuses. */
export async function sendVideoFeedback(
  feedback: VideoFeedback,
  request: Request,
): Promise<void> {
  const config = feedbackConfig();
  if (!config) throw new Error("Feedback email is not set up.");
  const { subject, text } = feedbackEmail(feedback, request);
  const { error } = await new Resend(config.apiKey).emails.send({
    from: config.from,
    to: config.to,
    subject,
    text,
    ...(feedback.email ? { replyTo: feedback.email } : {}),
  });
  if (error) throw new Error(`${error.name}: ${error.message}`);
}
