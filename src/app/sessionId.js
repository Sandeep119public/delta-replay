const SESSION_STORAGE_KEY = 'delta-replay.session-id';

function fallbackUuid() {
  const bytes = new Uint8Array(16);
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure randomness is required to create a session');
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getSessionId() {
  try {
    const existing = globalThis.sessionStorage?.getItem(SESSION_STORAGE_KEY);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) return existing;
    const generated = globalThis.crypto?.randomUUID?.() || fallbackUuid();
    globalThis.sessionStorage?.setItem(SESSION_STORAGE_KEY, generated);
    return generated;
  } catch (error) {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    throw new Error('Unable to create a secure session ID', { cause: error });
  }
}
