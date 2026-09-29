"use client";

import { useEffect, useState } from "react";

import { recordRecentDiagram } from "~/features/recent/recent-diagrams";

export interface PublicDiagram {
  owner: string;
  repo: string;
  lastSuccessfulAt: string | null;
}

async function fetchPublicDiagram(
  owner: string,
  repo: string,
  signal: AbortSignal,
): Promise<string | null | false> {
  // Answers only from the public namespace: a private repository's diagram
  // is stored apart and never found here.
  const response = await fetch(
    `/api/diagram-preview?${new URLSearchParams({ username: owner, repo }).toString()}`,
    { credentials: "omit", signal },
  );
  if (!response.ok) return false;
  const body: unknown = await response.json();
  const at =
    body && typeof body === "object" && "lastSuccessfulAt" in body
      ? body.lastSuccessfulAt
      : null;
  return typeof at === "string" ? at : null;
}

/**
 * The repository's diagram once it is known to be public and stored, or null.
 * Only then may the page offer README embeds or add it to the recent list,
 * which this also does.
 */
export function usePublicDiagram({
  owner,
  repo,
  ready,
  knownPublicAt,
}: {
  owner: string;
  repo: string;
  /** A finished diagram is on screen. */
  ready: boolean;
  /** When the server rendered a stored public diagram, its time. */
  knownPublicAt?: string | null;
}): PublicDiagram | null {
  const [found, setFound] = useState<PublicDiagram | null>(null);

  useEffect(() => {
    if (!ready) return;
    const confirm = (lastSuccessfulAt: string | null) => {
      const diagram = { owner, repo, lastSuccessfulAt };
      setFound(diagram);
      recordRecentDiagram(diagram);
    };
    if (knownPublicAt) {
      confirm(knownPublicAt);
      return;
    }
    const controller = new AbortController();
    fetchPublicDiagram(owner, repo, controller.signal)
      .then((result) => {
        if (result !== false && !controller.signal.aborted) confirm(result);
      })
      // Unknown means not offered: a private diagram must never be.
      .catch(() => undefined);
    return () => controller.abort();
  }, [knownPublicAt, owner, ready, repo]);

  return found?.owner === owner && found.repo === repo ? found : null;
}
