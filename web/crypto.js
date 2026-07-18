// Client-side crypto for log-origin
// Uses Web Crypto API — no WASM, no dependencies

const PBKDF2_ITERATIONS = 600_000;

export async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  const saltBytes = typeof salt === 'string'
    ? Uint8Array.from(atob(salt), c => c.charCodeAt(0))
    : salt;
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptData(data, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    typeof data === 'string' ? enc.encode(data) : data
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

export async function decryptData(iv, ciphertext, key) {
  const ivBytes = typeof iv === 'string'
    ? Uint8Array.from(atob(iv), c => c.charCodeAt(0))
    : iv;
  const ctBytes = typeof ciphertext === 'string'
    ? Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0))
    : ciphertext;
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    ctBytes
  );
  return new TextDecoder().decode(plain);
}

// PII Detection
const PII_PATTERNS = [
  { type: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'phone', regex: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g },
  { type: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: 'cc', regex: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g },
  { type: 'ip', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g },
];

export function detectPII(text) {
  const entities = [];
  for (const { type, regex } of PII_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      entities.push({ type, value: match[0], start: match.index, end: match.index + match[0].length });
    }
  }
  return entities;
}

export async function dehydrateClient(text, key) {
  const entities = detectPII(text);
  if (entities.length === 0) return { text, entityMap: null };

  const entityMap = {};
  let dehydrated = text;
  // Process in reverse to maintain indices
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    const id = `[${e.type.toUpperCase()}_${i + 1}]`;
    entityMap[id] = e.value;
    dehydrated = dehydrated.slice(0, e.start) + id + dehydrated.slice(e.end);
  }

  // Encrypt entity map
  const mapStr = JSON.stringify(entityMap);
  const encrypted = await encryptData(mapStr, key);
  const entityMapB64 = {
    iv: btoa(String.fromCharCode(...encrypted.iv)),
    ciphertext: btoa(String.fromCharCode(...encrypted.ciphertext))
  };
  return { text: dehydrated, entityMap: entityMapB64 };
}

export async function rehydrateClient(text, encryptedMap, key) {
  if (!encryptedMap) return text;
  const mapStr = await decryptData(encryptedMap.iv, encryptedMap.ciphertext, key);
  const entityMap = JSON.parse(mapStr);
  let rehydrated = text;
  for (const [id, value] of Object.entries(entityMap)) {
    rehydrated = rehydrated.replaceAll(id, value);
  }
  return rehydrated;
}
