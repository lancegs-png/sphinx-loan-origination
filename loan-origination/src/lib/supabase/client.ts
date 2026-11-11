'use client';
import { createBrowserClient } from '@supabase/ssr';

/**
 * Self-heal a corrupt Supabase auth cookie. A session cookie that has picked up a
 * control character (newline, etc.) makes every auth request throw
 * "Failed to execute 'fetch' on 'Window': Invalid value" — because that character
 * lands in the Authorization header, which fetch rejects before sending. These cookies
 * never legitimately contain control chars, so dropping a corrupt one is safe: it just
 * forces a fresh sign-in instead of bricking the login page. See auth troubleshooting.
 */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** True when an sb-* cookie is corrupt: a control char in the raw value, or, for the
 *  `base64-`-encoded session cookie, control chars inside the decoded JSON (a valid
 *  session's JSON never contains raw control chars) or undecodable base64. Chunked
 *  session fragments (…-auth-token.0/.1) aren't independently decodable, so they're left
 *  to the login page's error-triggered recovery instead of risking a false positive. */
function isCorruptAuthCookie(name: string, rawValue: string): boolean {
  if (/\.\d+$/.test(name)) return false;
  let value = rawValue;
  try { value = decodeURIComponent(rawValue); } catch { /* keep raw */ }
  if (CONTROL_CHARS.test(value)) return true;
  if (value.startsWith('base64-')) {
    try {
      let b64 = value.slice('base64-'.length).replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const decoded = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      return CONTROL_CHARS.test(decoded);
    } catch {
      return true; // undecodable → corrupt
    }
  }
  return false;
}

function clearCorruptAuthCookies() {
  if (typeof document === 'undefined') return;
  try {
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0]?.trim();
      if (!name || !name.startsWith('sb-')) continue;
      if (isCorruptAuthCookie(name, part.slice(part.indexOf('=') + 1))) {
        for (const scope of ['', `; domain=${location.hostname}`]) {
          document.cookie = `${name}=; Max-Age=0; path=/${scope}`;
        }
      }
    }
  } catch { /* best effort */ }
}

// Run once as soon as this module loads in the browser, before any client is created.
clearCorruptAuthCookies();

/** Browser client (ANON key + session). RLS applies. Used for realtime subscriptions and client reads. */
export function createClient() {
  clearCorruptAuthCookies();
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
