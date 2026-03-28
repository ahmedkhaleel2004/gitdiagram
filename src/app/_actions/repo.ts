"use server";

import { getDiagramStateRecord } from "~/server/db/diagram-state";

export async function getLastGeneratedDate(username: string, repo: string) {
  const state = await getDiagramStateRecord(username, repo);
  return state.lastSuccessfulAt ? new Date(state.lastSuccessfulAt) : undefined;
}
