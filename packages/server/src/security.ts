// Browser-mode protections for a localhost API: bearer token or HttpOnly SameSite=Strict cookie,
// Host allowlist against DNS rebinding, Origin check against cross-site requests, strict CSP.
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const COOKIE = 'mm_token';
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function sameToken(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function cookieToken(req: IncomingMessage): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return undefined;
}

export function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

const HTTP = { ok: 200, seeOther: 303, badRequest: 400, unauthorized: 401, forbidden: 403, notFound: 404, notAllowed: 405, tooLarge: 413, misdirected: 421, unprocessable: 422, internal: 500, unavailable: 503 } as const;
export { HTTP };

export interface Policy { token: string; allowedHosts: Set<string>; allowedOrigins: Set<string> }

/** Returns an error message, or null when the request may proceed. */
type Denial = { status: number; message: string } | null;

function checkPlace(req: IncomingMessage, policy: Policy): Denial {
  const host = req.headers.host ?? '';
  if (!policy.allowedHosts.has(host)) return { status: HTTP.misdirected, message: `host ${host} not allowed` };
  const origin = req.headers.origin;
  if (origin && !policy.allowedOrigins.has(origin)) return { status: HTTP.forbidden, message: `origin ${origin} not allowed` };
  return null;
}

/** Cookie auth is ambient: state-changing requests must also prove they come from our own origin. */
function checkCookieRequest(req: IncomingMessage): Denial {
  const unsafe = !['GET', 'HEAD'].includes(req.method ?? 'GET');
  const sameOrigin = Boolean(req.headers.origin) || req.headers['sec-fetch-site'] === 'same-origin';
  return unsafe && !sameOrigin ? { status: HTTP.forbidden, message: 'missing origin on cookie-authenticated request' } : null;
}

/** Returns why the request is refused, or null when it may proceed. */
export function checkRequest(req: IncomingMessage, policy: Policy, needsAuth: boolean): Denial {
  const place = checkPlace(req, policy);
  if (place || !needsAuth || sameToken(bearer(req), policy.token)) return place;
  if (sameToken(cookieToken(req), policy.token)) return checkCookieRequest(req);
  return { status: HTTP.unauthorized, message: 'authentication required' };
}

export function securityHeaders(res: ServerResponse): void {
  res.setHeader('content-security-policy', CSP);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('cross-origin-opener-policy', 'same-origin');
  res.setHeader('cross-origin-resource-policy', 'same-origin');
  res.setHeader('cache-control', 'no-store');
}
