const HTTP_PROTOCOLS = new Set(["http", "https"]);

function getFirstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const firstValue = value.split(",", 1)[0]?.trim();
  return firstValue || null;
}

function getExternalRequestOrigin(request: Request): string | null {
  const requestUrl = new URL(request.url);
  const forwardedHost = getFirstHeaderValue(
    request.headers.get("x-forwarded-host"),
  );
  const host = forwardedHost ?? request.headers.get("host") ?? requestUrl.host;
  const forwardedProtocol = getFirstHeaderValue(
    request.headers.get("x-forwarded-proto"),
  );
  const protocol = forwardedProtocol ?? requestUrl.protocol.replace(/:$/u, "");

  if (!HTTP_PROTOCOLS.has(protocol) || !host) {
    return null;
  }

  try {
    const externalUrl = new URL(`${protocol}://${host}`);
    if (
      externalUrl.username ||
      externalUrl.password ||
      externalUrl.pathname !== "/" ||
      externalUrl.search ||
      externalUrl.hash
    ) {
      return null;
    }
    return externalUrl.origin;
  } catch {
    return null;
  }
}

/**
 * Enforces browser same-origin requests while accounting for trusted platform
 * proxies that terminate TLS before forwarding to the Node.js server.
 */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const externalOrigin = getExternalRequestOrigin(request);
  if (!origin || !externalOrigin) {
    return false;
  }

  let normalizedOrigin: string;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    return false;
  }

  if (normalizedOrigin !== externalOrigin) {
    return false;
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin";
}
