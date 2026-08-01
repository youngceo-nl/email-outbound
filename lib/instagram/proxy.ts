/*
 * Proxy plumbing for authenticated Instagram work.
 *
 * The rule this exists to enforce: every request an account makes must leave
 * from that account's own IP, including the login itself. Minting a session
 * cookie from the server's address and then browsing with it from a residential
 * proxy is a worse signal than using no proxy at all — Instagram sees one
 * session whose network identity changed the instant it authenticated, which is
 * a shape organic traffic essentially never has.
 */

import { ProxyAgent } from "undici";

/** Playwright wants credentials split out of the server URL. */
export type PlaywrightProxy = {
  server: string;
  username?: string;
  password?: string;
};

/** A bare host:port is silently ignored by most clients; force a scheme. */
export function normalizeProxyUrl(raw: string): string {
  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
}

export function toPlaywrightProxy(raw: string | null | undefined): PlaywrightProxy | null {
  if (!raw?.trim()) return null;
  const url = new URL(normalizeProxyUrl(raw.trim()));
  const username = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  return {
    server: `${url.protocol}//${url.host}`,
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
  };
}

/*
 * Node's fetch accepts a `dispatcher`, but the DOM RequestInit type does not
 * describe it, hence the cast. Keeping the cast in one place stops it spreading
 * through every call site.
 */
type DispatcherInit = RequestInit & { dispatcher?: ProxyAgent };

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Returns a fetch bound to `proxyUrl`, or plain fetch when none is configured.
 *
 * Callers should thread the returned function through every request in a login
 * flow. A single un-proxied call is enough to leak the server's address into
 * the session's history.
 */
export function proxyFetch(proxyUrl: string | null | undefined): FetchLike {
  if (!proxyUrl?.trim()) return (input, init) => fetch(input, init);

  const dispatcher = new ProxyAgent(normalizeProxyUrl(proxyUrl.trim()));
  return (input, init) => fetch(input, { ...init, dispatcher } as DispatcherInit);
}
