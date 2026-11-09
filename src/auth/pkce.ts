// PKCE (RFC 7636) with S256, the only method mcp.wiro.ai accepts.

const VERIFIER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A random string from the unreserved set, 64 characters by default (43 to 128 allowed). */
export function randomString(length = 64): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = '';
  for (const byte of bytes) out += VERIFIER_CHARS[byte % VERIFIER_CHARS.length];
  return out;
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomString(64);
  return { verifier, challenge: await challengeFor(verifier) };
}
