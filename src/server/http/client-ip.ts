/**
 * Resolves the caller's IP from the platform's forwarding headers.
 *
 * These headers are only trustworthy because the deployment sits behind an
 * ingress that overwrites them. This is an abuse-control signal, not
 * authentication, and callers must treat a null result as "unattributable".
 */
export function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // The left-most entry is the originating client; everything after it was
    // appended by proxies closer to us.
    const candidate = forwardedFor.split(",", 1)[0]?.trim();
    if (candidate) {
      return normalizeIp(candidate);
    }
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) {
    return normalizeIp(realIp);
  }

  return null;
}

function normalizeIp(value: string): string | null {
  // Strip an IPv6 bracket wrapper and any trailing port so the same client
  // cannot occupy several rate-limit buckets.
  const withoutBrackets = value.startsWith("[")
    ? value.slice(1, value.indexOf("]") === -1 ? undefined : value.indexOf("]"))
    : value;
  // Exactly one colon means "IPv4:port"; a bare IPv6 address always has more.
  const withoutPort =
    withoutBrackets.split(":").length === 2
      ? (withoutBrackets.split(":", 1)[0] ?? withoutBrackets)
      : withoutBrackets;

  const normalized = withoutPort.trim().toLowerCase();
  if (!normalized || normalized.length > 64) {
    return null;
  }

  return /^[a-f0-9.:]+$/u.test(normalized) ? normalized : null;
}
