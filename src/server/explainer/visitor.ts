import "server-only";

import { randomUUID } from "node:crypto";

// Video budgets count per person, and a person here is one browser: a random
// id kept in a cookie. People who share an internet connection (an office, a
// university, a home) each get their own videos. Clearing the cookie gives a
// new id, so the per-connection backstop in limits.ts still bounds one person.

export const VISITOR_COOKIE =
  process.env.NODE_ENV === "production" ? "__Host-gd_visitor" : "gd_visitor";

const ONE_YEAR_SECONDS = 365 * 86_400;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Visitor {
  id: string;
  /** No valid cookie came in, so the response must set one. */
  fresh: boolean;
}

export function readVisitor(request: Request): Visitor {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, value] = part.trim().split("=");
    if (key === VISITOR_COOKIE && value && ID.test(value))
      return { id: value, fresh: false };
  }
  return { id: randomUUID(), fresh: true };
}

/** Hand a new visitor their id, so their next request counts as them. */
export function withVisitorCookie(
  response: Response,
  visitor: Visitor,
): Response {
  if (!visitor.fresh) return response;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${VISITOR_COOKIE}=${visitor.id}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; HttpOnly; SameSite=Lax${secure}`,
  );
  return response;
}
