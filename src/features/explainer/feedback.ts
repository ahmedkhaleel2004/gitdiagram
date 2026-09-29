import { useEffect, useState } from "react";

// Feedback on a video, emailed to the operator (src/server/explainer/feedback.ts).
// Only people in the priority places get the button; the server says who.

let open: Promise<boolean> | null = null;

/** Asked once per page load: the answer only changes with the visitor's place. */
function feedbackOpen(): Promise<boolean> {
  open ??= fetch("/api/video/feedback", { cache: "no-store" })
    .then((response) => response.json() as Promise<{ canSend?: boolean }>)
    .then((body) => body.canSend === true)
    .catch(() => {
      // A later panel asks again.
      open = null;
      return false;
    });
  return open;
}

/** Whether this visitor gets the feedback button. */
export function useCanSendFeedback(): boolean {
  const [canSend, setCanSend] = useState(false);
  useEffect(() => {
    let live = true;
    void feedbackOpen().then((value) => {
      if (live) setCanSend(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return canSend;
}

export async function sendFeedback(feedback: {
  username: string;
  repo: string;
  message: string;
  email: string;
  at?: number;
}): Promise<void> {
  const response = await fetch("/api/video/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...feedback,
      at:
        feedback.at === undefined
          ? undefined
          : Math.round(feedback.at * 10) / 10,
    }),
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  throw new Error(body.error ?? "Could not send feedback. Try again.");
}
