"use server";

import { getDiagramStateRecord } from "~/server/db/diagram-state";

export async function getLastGeneratedDate(
  username: string,
  repo: string,
  githubPat?: string,
) {
  const state = await getDiagramStateRecord(username, repo, githubPat);
  return state.lastSuccessfulAt ? new Date(state.lastSuccessfulAt) : undefined;
}
