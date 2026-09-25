/**
 * The value of the first cookie called `name` the request carries, or null.
 * Values are returned as sent (not decoded); an "=" inside one is kept.
 */
export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}
