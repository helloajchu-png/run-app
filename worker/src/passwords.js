// PBKDF2-SHA256 via WebCrypto. 100,000 iterations matches the KDF this worker
// already runs for community PINs, and stays inside a Worker invocation.
export const PASSWORD_ITERATIONS = 100000;
export const SESSION_MS = 400 * 24 * 60 * 60 * 1000;

export function hex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function bytesFromHex(value) {
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomHex(size = 16) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return hex(bytes);
}

export async function hashPassword(password, saltHex, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: bytesFromHex(saltHex),
    iterations,
    hash: 'SHA-256',
  }, key, 256);
  return hex(new Uint8Array(bits));
}

export async function verifyPassword(password, saltHex, expected, iterations = PASSWORD_ITERATIONS) {
  const actual = await hashPassword(password, saltHex, iterations || PASSWORD_ITERATIONS);
  return safeEqual(actual, String(expected || ''));
}

export function safeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export async function hashToken(token) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return hex(new Uint8Array(buf));
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

export function passwordOk(password) {
  const value = String(password ?? '');
  return value.length >= 8 && value.length <= 200;
}
