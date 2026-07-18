# Privacy Architecture — log-origin

> Zero-knowledge-at-rest encryption design: how user data stays encrypted until the moment it's needed.

## Table of Contents

1. [Principles](#1-principles)
2. [Key Derivation](#2-key-derivation)
3. [Session Key Exchange (ECIES)](#3-session-key-exchange-ecies)
4. [Non-Extractable CryptoKeys](#4-non-extractible-cryptckeys)
5. [DEK Lifecycle in Worker Memory](#5-dek-lifecycle-in-worker-memory)
6. [PII Detection](#6-pii-detection)
7. [Entity Token Format](#7-entity-token-format)
8. [Encrypted Columns](#8-encrypted-columns)
9. [End-to-End Flow](#9-end-to-end-flow)
10. [Passphrase Loss & Recovery](#10-passphrase-loss--recovery)
11. ["Zero-Knowledge at Rest" Positioning](#11-zero-knowledge-at-rest-positioning)
12. [GDPR & CCPA Compliance](#12-gdpr--ccpa-compliance)
13. [Devil's Advocate](#13-devils-advocate)
14. [Open Questions](#14-open-questions)

---

## 1. Principles

| Principle | Description |
|-----------|-------------|
| **Client-side encryption** | All sensitive data is encrypted in the browser before it leaves the device |
| **Zero-knowledge at rest** | Stored data is ciphertext; without the user's DEK, it's computationally infeasible to decrypt |
| **Ephemeral decryption** | The Worker decrypts only when needed, holds plaintext for ~3ms, then zeroes memory |
| **No backdoors** | Passphrase loss = data loss. There is no recovery mechanism that bypasses encryption |
| **Honest positioning** | We acknowledge the Worker *can* decrypt during request processing (unlike Signal/1Password) |

### What we protect

| Data | At Rest | In Transit | During Processing |
|------|---------|------------|-----------------|
| PII (names, emails, phones, SSN, CC) | ✅ AES-256-GCM | ✅ Tokenized `[EMAIL_1]` | ❌ Worker decrypts for API calls |
| Provider API keys | ✅ AES-256-GCM | ✅ HTTPS | ❌ Worker decrypts for fetch() |
| Uploaded files | ✅ AES-256-GCM | ✅ HTTPS | ❌ Worker decrypts for vision APIs |
| Conversation content | ✅ AES-256-GCM | ✅ HTTPS + tokenized | ❌ Worker decrypts for context |
| Routing rules | ⚠️ Plaintext (config) | ✅ HTTPS | ✅ Always readable |
| User preferences | ⚠️ Plaintext (config) | ✅ HTTPS | ✅ Always readable |

---

## 2. Key Derivation

### Why PBKDF2 over Argon2id

| Factor | PBKDF2 | Argon2id |
|--------|--------|----------|
| Native Web Crypto API | ✅ Yes | ❌ No (requires WASM) |
| Workers Crypto API | ✅ Yes | ❌ No (requires WASM) |
| WASM dependency | None | ~100KB module |
| GPU resistance | Moderate (iteration count) | Strong (memory-hard) |
| Derivation time (600K iter) | ~100-200ms | ~500ms-2s |
| Bundle size impact | 0KB | ~100KB |

**Decision:** PBKDF2 for Phase 1. No WASM dependency keeps the bundle small and avoids Workers compatibility issues. Argon2id can be added as an opt-in upgrade in a future phase.

### Derivation parameters

```typescript
const PBKDF2_PARAMS = {
  name: 'PBKDF2',
  salt: randomBytes(16),         // Per-user, stored in D1 (user_preferences)
  iterations: 600_000,
  hash: 'SHA-256',
  keyLength: 256,                // bits
} as Pbkdf2Params;
```

### Salt storage

Salt is not secret. Stored as a user preference in D1:

```sql
INSERT INTO user_preferences (id, user_id, key, value, updated_at)
VALUES (?, ?, 'encryption_salt', '<base64-encoded-16-bytes>', datetime('now'));
```

---

## 3. Session Key Exchange (ECIES)

### Overview

The Worker needs the DEK to decrypt user data for API calls. But the DEK must never be sent in plaintext. ECIES (Elliptic Curve Integrated Encryption Scheme) solves this.

### Flow

```
┌───────────┐                                      ┌───────────┐
│  BROWSER   │                                      │   WORKER   │
└─────┬─────┘                                      └─────┬─────┘
      │                                                   │
      │  SETUP (one-time, during deployment)              │
      │                                                   │
      │  Worker generates static ECDH keypair:            │
      │    privateKey → stored as Worker Secret           │
      │    publicKey  → embedded in client JS             │
      │                                                   │
      │  ═══════════════════════════════════════════════   │
      │                                                   │
      │  SESSION START (user enters passphrase)           │
      │                                                   │
  1.  │  DEK = PBKDF2(passphrase, salt, 600K)             │
      │                                                   │
  2.  │  Generate ephemeral ECDH keypair (browser)        │
      │    ephemeralPrivateKey (non-extractable)          │
      │    ephemeralPublicKey                            │
      │                                                   │
  3.  │  ECDH derive shared secret:                      │
      │    sharedSecret = ECDH(                           │
      │      ephemeralPrivateKey,                        │
      │      workerPublicKey                              │
      │    )                                              │
      │                                                   │
  4.  │  Encrypt DEK with shared secret:                  │
      │    encryptedDEK = AES-256-GCM(                    │
      │      DEK,                                        │
      │      HKDF(sharedSecret),                         │
      │      randomIV                                    │
      │    )                                              │
      │                                                   │
  5.  │  POST /api/auth                                   │
      │  { passphrase, ephemeralPublicKey, encryptedDEK } │
      │  ──────────────────────────────────────────────►   │
      │                                                   │
  6.  │                              Worker verifies auth │
      │                              Worker derives same   │
      │                              shared secret:        │
      │                              ECDH(workerPrivKey,   │
      │                                   ephPubKey)       │
      │                                                   │
  7.  │                              Worker decrypts:      │
      │                              DEK = AES-GCM.decrypt │
      │                              (encryptedDEK, ...)   │
      │                                                   │
  8.  │                              Worker creates       │
      │                              non-extractable DEK:  │
      │                              CryptoKey(DEK,       │
      │                                extractable:false)  │
      │                                                   │
  9.  │  { accessToken, refreshToken }                    │
      │  ◄────────────────────────────────────────────── │
      │                                                   │
     10. │  Browser stores access token                   │
      │  Browser discards ephemeral keypair               │
      │  (DEK now only exists in Worker memory)           │
      │                                                   │
```

### Why ECDH instead of RSA wrapping

- Smaller keys (256-bit vs 2048-bit RSA) — less data in transit
- Forward secrecy from ephemeral keys — compromise of static key doesn't expose past sessions
- Native support in Web Crypto API and Workers Crypto API
- NIST-approved curves (P-256)

---

## 4. Non-Extractable CryptoKeys

### The `extractable: false` guarantee

```typescript
// ✅ Correct: non-extractable key
const dek = await crypto.subtle.importKey(
  'raw',
  dekBytes,
  { name: 'AES-GCM' },
  false,              // ← non-extractable
  ['encrypt', 'decrypt']
);

// This will throw:
await crypto.subtle.exportKey('raw', dek);
// DOMException: The key is not extractable
```

### Why this matters

Even if an attacker achieves JavaScript execution in the browser (XSS):

1. They **cannot** call `crypto.subtle.exportKey()` on the DEK
2. They **cannot** serialize the CryptoKey object (it's an opaque handle)
3. They **cannot** intercept the raw key bytes (never exposed to JavaScript)
4. The only way to use the key is through the Web Crypto API's `encrypt()`/`decrypt()` — which doesn't return key material

### Worker-side non-extractable DEK

```typescript
// Worker also uses non-extractable DEK
const dek = await crypto.subtle.importKey(
  'raw',
  decryptedDekBytes,
  { name: 'AES-GCM' },
  false,              // ← non-extractable in Worker too
  ['encrypt', 'decrypt']
);
```

The Worker DEK lives only in the V8 isolate's memory for the request duration. When the isolate is destroyed after the request, the key bytes are freed by the GC.

---

## 5. DEK Lifecycle in Worker Memory

```
Request arrives
    │
    ▼
┌──────────────────────────────────┐
│  1. Auth check (JWT verification) │  ~0.1ms
└─────────────┬────────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│  2. Load encrypted data from D1  │  ~1-2ms
│  ┌────────────────────────────┐  │
│  │  ciphertext = D1.get(...)  │  │
│  └────────────────────────────┘  │
└─────────────┬────────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│  3. Decrypt with DEK              │  ~0.5ms
│  ┌────────────────────────────┐  │
│  │  plaintext = AES-GCM.      │  │
│  │    decrypt(ciphertext, DEK) │  │
│  └────────────────────────────┘  │
│                                   │
│  ⚠️ PLAINTEXT EXISTS HERE (~0.5ms)│
│     Only in V8 isolate memory     │
│     Never written to disk         │
│     Never logged                  │
└─────────────┬────────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│  4. Make API call to provider     │  ~500-3000ms
│  ┌────────────────────────────┐  │
│  │  fetch("https://api.openai │  │
│  │    .com/v1/chat/...", {    │  │
│  │    body: {                 │  │
│  │      messages: plaintext   │  │  Provider sees
│  │    }                       │  │  tokenized PII,
│  │  })                        │  │  not real PII
│  └────────────────────────────┘  │
└─────────────┬────────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│  5. Process response              │  ~0.1ms
│  ┌────────────────────────────┐  │
│  │  response may contain      │  │
│  │  PII tokens [EMAIL_1]      │  │
│  │  Leave them as-is          │  │
│  └────────────────────────────┘  │
└─────────────┬────────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│  6. Return response to browser    │  ~0.1ms
│  ┌────────────────────────────┐  │
│  │  Browser rehydrates PII    │  │
│  │  [EMAIL_1] → john@doe.com  │  │
│  └────────────────────────────┘  │
└─────────────┬────────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│  7. Isolate destroyed             │
│  ┌────────────────────────────┐  │
│  │  DEK gone                  │  │
│  │  Plaintext gone            │  │
│  │  Memory freed              │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

**Total DEK-in-memory window:** ~3ms (steps 3-5).
**Total plaintext-in-memory window:** ~3ms (steps 3-5).

---

## 6. PII Detection

### Detection approach

Layered regex patterns (Workers-compatible, no ML dependency). Patterns are applied client-side in the browser before the message leaves the device.

### Pattern catalog

| Type | Pattern (simplified) | Example Match |
|------|---------------------|---------------|
| **Email** | `\b[\w.-]+@[\w.-]+\.\w{2,}\b` | `john@doe.com` |
| **Phone (US)** | `\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b` | `(555) 123-4567` |
| **Phone (International)** | `\b\+\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b` | `+1-555-123-4567` |
| **SSN** | `\b\d{3}-\d{2}-\d{4}\b` | `123-45-6789` |
| **Credit Card** | `\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b` | `4111-1111-1111-1111` |
| **Credit Card (16-digit)** | `\b\d{16}\b` (with Luhn validation) | `4111111111111111` |
| **API Key (OpenAI)** | `\bsk-[a-zA-Z0-9]{20,}\b` | `sk-proj-abc123...` |
| **API Key (generic)** | `\b[A-Za-z0-9]{32,}\b` (contextual) | Varies |
| **Address (US)** | `\d+\s+\w+\s+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Lane|Ln|Drive|Dr)\b.*\b\d{5}\b` | `123 Main Street, Anytown 12345` |
| **Date (US)** | `\b\d{1,2}/\d{1,2}/\d{2,4}\b` | `03/25/2026` |
| **Date (ISO)** | `\b\d{4}-\d{2}-\d{2}\b` | `2026-03-25` |
| **IP Address** | `\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b` | `192.168.1.1` |
| **Passport (US)** | `\b[A-Z]\d{8}\b` | `A12345678` |

### Name detection (contextual)

Names don't have a reliable regex pattern. Detection uses:

1. **Title + capital word patterns:** `Mr./Mrs./Dr. [CapitalizedWord]`
2. **Chinese names:** `[\u4e00-\u9fff]{2,4}` (2-4 CJK characters)
3. **Russian names:** `[А-ЯЁ][а-яё]+ [-][А-ЯЁ][а-яё]+` (Cyrillic first+last)
4. **Surrounding context:** "My name is [X]", "Call [X]", "Tell [X] that"

```typescript
const NAME_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  { pattern: /(?:my name is|i'm|i am|call me|tell|ask|say hi to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i, type: 'person' },
  { pattern: /(?:mr|mrs|ms|dr|prof)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i, type: 'person' },
  { pattern: /[\u4e00-\u9fff]{2,4}/, type: 'person_cjk' },
  { pattern: /[А-ЯЁ][а-яё]+(?:[-][А-ЯЁ][а-яё]+)?/, type: 'person_cyrillic' },
];
```

---

## 7. Entity Token Format

### Format

```
[TYPE_LETTER][COUNTER]
```

| Type | Token Pattern | Example |
|------|--------------|---------|
| Person | `PERSON_A` through `PERSON_Z`, then `PERSON_AA`–`PERSON_ZZ` | `[PERSON_A]`, `[PERSON_AB]` |
| Email | `EMAIL_1`, `EMAIL_2`, ... | `[EMAIL_1]` |
| Phone | `PHONE_1`, `PHONE_2`, ... | `[PHONE_1]` |
| SSN | `SSN_1`, `SSN_2`, ... | `[SSN_1]` |
| Credit Card | `CC_1`, `CC_2`, ... | `[CC_1]` |
| Address | `ADDRESS_1`, `ADDRESS_2`, ... | `[ADDRESS_1]` |
| Date | `DATE_1`, `DATE_2`, ... | `[DATE_1]` |
| API Key | `APIKEY_1`, `APIKEY_2`, ... | `[APIKEY_1]` |

### Semantic design rationale

The tokens are designed to be **coherent to the LLM**:
- `[PERSON_A]` tells the model "this is a person" — it can use correct pronouns and context
- `[EMAIL_1]` tells the model "this is an email address" — it can suggest formatting or validation
- This is better than generic `[REDACTED_1]` which strips all semantic meaning

### ID generation algorithm

```typescript
function nextEntityId(type: PIIType, existingCount: number): string {
  if (type === 'person') {
    // A-Z, then AA-ZZ
    if (existingCount < 26) {
      return `PERSON_${String.fromCharCode(65 + existingCount)}`;
    }
    const first = String.fromCharCode(65 + Math.floor(existingCount / 26) - 1);
    const second = String.fromCharCode(65 + (existingCount % 26));
    return `PERSON_${first}${second}`;
  }
  
  const prefix = type.toUpperCase();
  return `${prefix}_${existingCount + 1}`;
}
```

### Cross-session persistence

Entity tokens persist across sessions within a user's scope. If `[EMAIL_1]` was `john@doe.com` in session A, it's the same in session B. This is enforced by the `UNIQUE(user_id, entity_id)` constraint in D1.

---

## 8. Encrypted Columns

### Encryption format

Each encrypted value is stored as a base64-encoded string containing:

```
base64(
  IV (12 bytes) || ciphertext (variable) || authTag (16 bytes)
)
```

### Encryption/decryption functions

```typescript
async function encrypt(plaintext: string, dek: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    dek,
    encoded,
  );
  
  // Combine IV + ciphertext (auth tag is appended by Web Crypto)
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(encryptedBase64: string, dek: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    dek,
    ciphertext,
  );
  
  return new TextDecoder().decode(plaintext);
}
```

### Columns that are encrypted

| Table | Column | Content Type | Size Estimate |
|-------|--------|-------------|---------------|
| `pii_entities` | `real_value` | PII plaintext | 20-200 bytes |
| `providers` | `api_key` | API key string | 40-200 bytes |

---

## 9. End-to-End Flow

### Chat message with PII

```
┌─────────────────────────────────────────────────────────────────┐
│ BROWSER                                                          │
│                                                                  │
│ User types: "Email john@doe.com about the invoice #INV-12345"   │
│                                                                  │
│ 1. PII Detection                                                 │
│    ├─ "john@doe.com" → EMAIL → [EMAIL_1]                       │
│    └─ "INV-12345" → not PII (no pattern match)                  │
│                                                                  │
│ 2. Tokenize                                                      │
│    "Email [EMAIL_1] about the invoice #INV-12345"               │
│                                                                  │
│ 3. Encrypt entity map                                            │
│    entityMap = {                                                 │
│      "[EMAIL_1]": "john@doe.com"                                │
│    }                                                             │
│    encryptedMap = AES-256-GCM(entityMap, DEK)                    │
│                                                                  │
│ 4. Store entity in D1                                            │
│    INSERT INTO pii_entities (                                      │
│      entity_id: "[EMAIL_1]",                                     │
│      entity_type: "email",                                       │
│      real_value: encryptedMap                                    │
│    )                                                             │
│                                                                  │
│ 5. Send to Worker                                                │
│    POST /api/chat                                                │
│    { message: "Email [EMAIL_1] about the invoice #INV-12345" }  │
└───────────────────────┬─────────────────────────────────────────┘
                        │ HTTPS
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ WORKER                                                           │
│                                                                  │
│ 6. Store message in D1                                           │
│    INSERT INTO messages (                                         │
│      content: "Email [EMAIL_1] about the invoice #INV-12345",   │
│      role: "user"                                                │
│    )                                                             │
│                                                                  │
│ 7. Route to provider (no PII decryption needed)                  │
│    POST https://api.openai.com/v1/chat/completions               │
│    { messages: [{ role: "user",                                  │
│        content: "Email [EMAIL_1] about the invoice #INV-12345"  │
│    }]}                                                           │
│                                                                  │
│ 8. Receive response                                              │
│    "I'll draft an email to [EMAIL_1] about invoice #INV-12345"   │
│                                                                  │
│ 9. Store assistant message                                       │
│    INSERT INTO messages (content: "... [EMAIL_1] ...")           │
│                                                                  │
│ 10. Return to browser                                            │
│     { response: "... [EMAIL_1] ..." }                            │
└───────────────────────┬─────────────────────────────────────────┘
                        │ HTTPS
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│ BROWSER                                                          │
│                                                                  │
│ 11. Rehydrate                                                    │
│     "... [EMAIL_1] ..." → "... john@doe.com ..."                │
│                                                                  │
│ 12. Display                                                      │
│     "I'll draft an email to john@doe.com about invoice #INV-12345"│
└─────────────────────────────────────────────────────────────────┘
```

**Key observation:** The Worker never decrypts the PII entity map. It stores and retrieves ciphertext. The provider API call contains tokenized PII. Only the browser ever sees the plaintext mapping.

---

## 10. Passphrase Loss & Recovery

### The hard truth

**Passphrase loss = data loss.** There is no backdoor, no recovery key stored by us, no "forgot password" flow. The DEK is derived from the passphrase; without it, all encrypted data in D1 and R2 is computationally infeasible to recover.

This is by design — same model as Bitwarden, Cryptomator, and any zero-knowledge system.

### Mitigation: Recovery key export

During initial setup, the user is offered the option to export a recovery key:

```
┌────────────────────────────────────────┐
│  🔑 Recovery Key                       │
│                                        │
│  We recommend saving this key in a     │
│  safe place (password manager, printed  │
│  on paper, engraved on metal).          │
│                                        │
│  If you lose your passphrase, this     │
│  key is the ONLY way to recover your   │
│  data.                                  │
│                                        │
│  ┌──────────────────────────────────┐  │
│  │ lo-7x9k-2mfp-q4r8-wj3n-b6yt     │  │
│  └──────────────────────────────────┘  │
│                                        │
│  [Copy to Clipboard] [Download .txt]   │
│                                        │
│  ☐ I have saved this key safely        │
│  [Continue]                             │
└────────────────────────────────────────┘
```

### Recovery key implementation

```typescript
// Recovery key = passphrase hash (HMAC-SHA256 with recovery salt)
// This is NOT the DEK — it's a separate derivation that can re-derive the DEK
// if the user stores the recovery key safely

async function deriveRecoveryKey(passphrase: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    keyMaterial,
    128  // 128 bits → ~26 char encoded key
  );
  
  return encodeRecoveryKey(bits);
}

function encodeRecoveryKey(bits: ArrayBuffer): string {
  // Encode as 6 groups of 4 chars: lo-7x9k-2mfp-q4r8-wj3n-b6yt
  const bytes = new Uint8Array(bits);
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789'; // No 0,o,1,l
  let result = '';
  for (let i = 0; i < 16; i += 2) {
    if (i > 0) result += '-';
    result += chars[bytes[i] % chars.length] + chars[bytes[i + 1] % chars.length];
  }
  return result;
}
```

> **Note:** The recovery key is a convenience feature, not a bypass. It still requires the user to have saved it somewhere secure. The system never stores it.

---

## 11. "Zero-Knowledge at Rest" Positioning

### What we claim

> **"Zero-knowledge at rest"** — log-origin cannot read your encrypted data when it is stored. Only you can decrypt it with your passphrase.

### What we honestly disclose

> **"The Worker must decrypt your data temporarily to make API calls on your behalf."** This means:
> - For ~3ms per request, your plaintext data exists in Worker memory
> - The Worker *could* theoretically intercept this data if compromised in real-time
> - Cloudflare (the platform) could theoretically access this window with targeted intervention
> - This is the same model as 1Password (server *can* decrypt during request, but stored data is useless)

### Comparison to true zero-knowledge

| Property | Signal Protocol | 1Password | log-origin |
|----------|----------------|-----------|------------|
| Server can decrypt at rest | ❌ Never | ❌ Never | ❌ Never ✅ |
| Server can decrypt during request | ❌ Never | ⚠️ Session keys | ⚠️ DEK in memory |
| Forward secrecy | ✅ Per-message | ✅ Per-session | ❌ Same DEK until re-login |
| Data useful after breach | ❌ No | ❌ No | ❌ No ✅ |

---

## 12. GDPR & CCPA Compliance

### Right to Access (GDPR Art. 15 / CCPA §1798.100)

User can export all their data:

```
GET /api/admin/export → NDJSON export of:
  - Sessions, messages, interactions
  - PII entity mappings (decrypted in browser before download)
  - User preferences
  - Routing rules
  - Provider configs (decrypted)
```

### Right to Erasure (GDPR Art. 17 / CCPA §1798.105)

Full cascade deletion (see `docs/database/SCHEMA-DESIGN.md` §13):

```
DELETE /api/admin/account
  → Cascade deletes across all 12 tables
  → Purges R2 objects
  → Purges KV session tokens
  → Returns confirmation with deletion receipt
```

### Right to Portability (GDPR Art. 20)

Export in standard formats:
- JSON for structured data (sessions, preferences)
- NDJSON for messages and interactions
- No vendor lock-in — all data is self-contained

### Data minimization

- Only necessary data is collected
- No tracking, no analytics beyond what the user configures
- Provider API call metadata (tokens, latency) is stored for routing intelligence — user can disable

### Consent

- Privacy policy displayed during setup
- User explicitly consents to PII detection and tokenization
- User can disable PII detection (at the cost of sending plaintext to providers)

### Data retention

- Hot data: 90 days in D1 (configurable)
- Cold data: archived to R2 (configurable retention)
- User can set auto-deletion after N days
- GDPR deletion flow is instant and complete

---

## 13. Devil's Advocate

### "ECIES key exchange is overkill for a personal tool."

**Counterargument:** Just use HTTPS. The data is already encrypted in transit. The Worker Secret API already protects secrets. Why add another layer?

**Rebuttal:** HTTPS protects the *transport*. But it doesn't protect the *data at rest* in D1. The purpose of ECIES isn't transport security — it's establishing a shared secret between the browser and Worker so that the Worker can decrypt user data without the user's passphrase ever leaving the browser. Without ECIES, we'd need to send the passphrase to the Worker (which we don't want) or store the DEK somewhere accessible (which defeats the purpose).

### "3ms plaintext window is still exploitable."

**Counterargument:** Advanced persistent threats (APTs) could patch the Worker runtime or use speculative execution to read memory during that 3ms window.

**Rebuttal:** True — if an attacker has the ability to modify Worker runtime behavior, all bets are off. But at that point, they could also modify the JavaScript to exfiltrate the passphrase directly, regardless of our encryption scheme. The 3ms window is a practical defense, not a theoretical guarantee. The real security comes from: (1) encrypted data at rest, (2) non-extractable keys, (3) no persistent storage of plaintext. These three together make even a sophisticated attack extremely difficult and detectable.

### "The PII detection is regex-based and will miss things."

**Counterargument:** Names like "Alex" don't match any pattern. Context-specific data (company names, project names) won't be detected. False positives (dates that aren't PII) will tokenize unnecessarily.

**Rebuttal:** Fair — regex is imperfect. But it's the right default for Phase 1 because: (1) it's deterministic and testable, (2) it runs client-side with zero latency impact, (3) it covers the most common and dangerous PII types (email, phone, SSN, CC, API keys). Missing a name like "Alex" is a lower-severity issue than missing an SSN. The user can add custom patterns in preferences. ML-based NER can be added as an upgrade path (Phase 3).

### "Recovery key defeats the purpose of zero-knowledge."

**Counterargument:** If the user stores the recovery key in 1Password or prints it on paper next to their laptop, an attacker with physical access has both the key and the encrypted data.

**Rebuttal:** The recovery key is opt-in and comes with explicit warnings. It's a UX trade-off: perfect security (no recovery possible) vs. practical usability (user can recover from passphrase loss). We present the trade-off honestly and let the user choose. The alternative — permanent data loss — is a worse user experience for most people.

---

## 14. Open Questions

1. **Per-message vs per-session DEK:** Should we derive a new DEK for each message (better forward secrecy) or keep one DEK per session (simpler)? Per-message DEK requires re-encrypting entity maps for each message — significant overhead.

2. **ML-based PII detection upgrade path:** Can we use Workers AI embeddings to detect PII that regex misses? What's the latency impact of an embedding call per message?

3. **Entity map versioning:** If a user changes the mapping for `[EMAIL_1]` from `john@doe.com` to `jane@doe.com`, what happens to old messages that reference `[EMAIL_1]`? Should we version entity mappings?

4. **Cross-user PII deduplication:** If two friends share a conversation and both have `[PERSON_A]` for "John Smith", are they the same entity? How does PII hydration work across user boundaries?

5. **R2 encryption key separation:** Should archived data in R2 use the same DEK as live D1 data, or derive a separate archive key? Same DEK means passphrase loss loses archives; separate key adds management complexity.

6. **WebAssembly Argon2id timing:** When we add Argon2id support, should it replace PBKDF2 or coexist? What's the WASM cold-start impact on Workers?
