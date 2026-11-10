// Parses what the user types into "Mind Meld: Connect": either a plain server URL or the one-time login URL
// the server prints (`http://127.0.0.1:PORT/auth?token=TOKEN`). The token is never logged; use redactUrl.

export interface ConnectionInput { baseUrl: string; token: string | null }

export function parseConnectionInput(input: string): ConnectionInput | null {
  let url: URL;
  try { url = new URL(input.trim()); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const token = url.pathname.replace(/\/+$/, '').endsWith('/auth') ? url.searchParams.get('token') : null;
  const path = token ? url.pathname.replace(/\/auth\/*$/, '') : url.pathname;
  return { baseUrl: `${url.origin}${path.replace(/\/+$/, '')}`, token: token || null };
}

/** The browser login URL for a server; it embeds the token, so it must only go to openExternal. */
export function loginUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/auth?token=${encodeURIComponent(token)}`;
}

export function redactUrl(text: string): string {
  return text.replace(/([?&]token=)[^&\s]+/g, '$1***');
}
