# Zero-Knowledge Privacy Vault on Cloudflare — Research Journey

> **LOG-mcp Principle:** Your personal data never leaves your control.

---

## 1. Client-Side Encryption Pattern

### Recommended: AES-256-GCM + PBKDF2/Argon2id

```
Browser                              Cloudflare
────────                             ──────────
passphrase ──→ PBKDF2/Argon2id ──→ DEK (256-bit)
                    │
                    ▼
              AES-256-GCM encrypt(plaintext, DEK)
                    │
                    ▼
           ciphertext + IV + auth tag
                    │
                    ───── HTTP POST ────→ stored in D1/KV (never decrypted here)
```

**Key derivation:**
- `DEK = PBKDF2(passphrase, salt, 600,000 iterations, SHA-256, 256 bits)`
- Salt: random 16 bytes, stored alongside ciphertext (not secret)
- For stronger protection: use WebAssembly Argon2id (higher memory cost, GPU-resistant)

**Why AES-256-GCM:**
- Authenticated encryption — tampering is detected
- Web Crypto API native support in Workers AND browsers
- Standard, audited, no surprises

**Session key exchange for Worker decryption:**

```
Browser                              Worker (edge)
────────                             ─────────────
1. Derive DEK from passphrase
2. Generate ephemeral ECDH keypair
3. Encrypt DEK with Worker's static public key (ECIES)
4. Send: { encryptedDEK, ciphertext, iv, tag }
                    │
                    ▼
5. Worker decrypts DEK using its private key
6. Worker decrypts payload with DEK
7. Worker uses plaintext for API call
8. Worker discards DEK from memory
```

**Wait — there's a subtlety.** If the Worker has a static private key, Cloudflare (or anyone with access to the Worker secrets) could decrypt the DEK. This means the Worker *can* decrypt user data, which is necessary for the use case (making API calls with the user's PII).

**The threat model is:** encrypted at rest in D1/KV/R2, decrypted ephemerally in Worker memory only when needed. Cloudflare as a platform *could* theoretically read it during that window, but:
- Data is never written to disk
- Worker memory is isolated per-request
- The window is milliseconds
- Cloudflare would need targeted, per-request interception

This is the same model as 1Password — the server *could* decrypt if compromised in real-time, but the stored data is useless without the key exchange.

### Alternative: True Zero-Knowledge with Client-Side Proxy

For maximum paranoia, the *browser itself* could decrypt and make the API call directly (no Worker decryption needed). The Worker just routes. This trades UX for perfect zero-knowledge.

---

## 2. Ephemeral Decryption at the Edge

### Architecture

```
Request arrives at Worker
         │
         ▼
┌─────────────────────────┐
│  Load encrypted blob    │  ← from D1/KV/R2
│  from storage            │
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│  Decrypt in memory      │  ← DEK exists only here
│  (Web Crypto API)       │     ~1-5ms
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│  Make API call to       │
│  provider (OpenAI etc)  │  ← plaintext only in this hop
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│  Get response           │
│  Re-encrypt PII         │
│  Store result           │
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│  Overwrite DEK in       │  ← zero out memory (set to 0)
│  memory, return resp    │     crypto.destroy() equivalent
└─────────────────────────┘
```

### Workers Security Properties

| Property | Status |
|----------|--------|
| No disk persistence | ✅ Workers are stateless, no filesystem |
| Memory isolation | ✅ Each request gets its own isolate |
| CPU time limit | 30s (paid) / 10ms (free) — more than enough for crypto |
| Memory limit | 128MB — plenty for encryption ops |
| Debug access | ⚠️ Cloudflare engineers *can* attach debuggers, but this requires targeted intervention |
| Cold start | ~5ms — no material impact on security |

### Key Lifecycle in Memory

```
DEK loaded → used → zeroed
  |                |        |
  ~0ms           ~2ms     ~3ms (total lifecycle)
```

JavaScript doesn't guarantee memory zeroing (GC is non-deterministic), but:
- Use `CryptoKey` objects marked `extractable: false`
- Worker isolate is destroyed after request
- The window is so short that practical exploitation is extremely difficult

---

## 3. PII Entity Map

### Current Design

```
User says: "Email john@doe.com about the invoice"
     │
     ▼
Client tokenizes → "Email [EMAIL_1] about the invoice"
     │
     ▼
Entity map: { "[EMAIL_1]": "john@doe.com" } → encrypted → stored in D1
```

### Enhanced Design

```
Entity map structure (JSON):
{
  "version": 1,
  "salt": "<16 bytes random>",
  "entities": {
    "EMAIL_1": "john@doe.com",
    "PERSON_1": "Jane Smith",
    "CC_1": "4111-1111-1111-1111",
    "SSN_1": "123-45-6789"
  }
}
     │
     ▼
Encrypted with DEK (AES-256-GCM)
     │
     ▼
Stored in D1: users/{userId}/entity_map
```

### PII Stripping Flow

```
User message (plaintext in browser)
     │
     ▼
Client-side NER detects PII → replaces with tokens
     │
     ▼
Tokenized message + encrypted entity map sent to Worker
     │
     ▼
Worker stores encrypted map in D1
Worker sends tokenized message to AI provider
     │
     ▼
AI response arrives (may contain tokens)
Worker rehydrates: [EMAIL_1] → decrypt map → john@doe.com
     │
     ▼
Re-encrypted response sent back to browser
Browser decrypts final response for display
```

**Client-side NER options:**
- `transformers.js` (runs in browser, local ML model)
- Regex-based detection (simpler, faster, good enough for structured PII)
- Hybrid: regex first, ML for edge cases

---

## 4. File/Photo Handling

### Upload Flow

```
Browser                               Cloudflare
───────                               ──────────
User selects photo
     │
     ▼
Generate random IV
AES-256-GCM encrypt(photo bytes, DEK)
     │
     ▼
POST encrypted blob + IV + tag → Worker → R2
                                (Worker never decrypts on upload)
```

### Inference Flow (Vision Model)

```
Browser → Worker: "analyze my kid's photo" + photoId
     │
     ▼
Worker fetches encrypted blob from R2
     │
     ▼
Worker decrypts with session DEK (in memory only)
     │
     ▼
Worker sends base64 image to OpenAI Vision API
     │
     ▼
OpenAI response arrives
     │
     ▼
Worker re-encrypts any PII in response
Worker DEK zeroed from memory
     │
     ▼
Encrypted response → Browser
Browser decrypts for display
```

### Storage Structure

```
R2 bucket: log-mcp-vault-{userId}/
├── photos/
│   ├── {uuid}.enc          # encrypted image
│   └── {uuid}.meta.json    # { iv, tag, timestamp, name }
├── documents/
│   ├── {uuid}.enc          # encrypted PDF/doc
│   └── {uuid}.meta.json
└── keys/                   # (if using per-file keys)
    └── {uuid}.key.enc      # DEK encrypted with master key
```

---

## 5. API Key Management

### Design

```
Setup (one-time, in browser):
─────────────────────────────
User enters: OpenAI API key "sk-proj-abc123..."
     │
     ▼
Encrypt with DEK (AES-256-GCM)
     │
     ▼
POST encrypted key to Worker → stored in KV or D1 encrypted_secrets table

Runtime:
────────
API call arrives at Worker
     │
     ▼
Worker fetches encrypted API key from KV/D1
Worker decrypts with session DEK
     │
     ▼
fetch("https://api.openai.com/v1/chat/completions", {
  headers: { "Authorization": `Bearer ${decryptedKey}` }
})
     │
     ▼
Response processed
DEK zeroed, API key removed from memory
```

### Key Rotation

- User updates API key in browser → new encrypted value overwrites old
- Old encrypted values can be purged on schedule
- Each provider key stored separately (independent rotation)

### What LOG-mcp Can Never See

- The API key is encrypted BEFORE leaving the browser
- Worker decrypts in memory only, never logs it
- Cloudflare D1/KV stores only ciphertext
- Even with full database dump, keys are AES-256-GCM encrypted
- **Without the user's DEK, the keys are computationally infeasible to recover**

---

## 6. Threat Model Matrix

| Threat | Impact | Likelihood | Mitigation |
|--------|--------|------------|------------|
| **Cloudflare data breach** (DB dump) | Encrypted data stolen | Medium | AES-256-GCM with passphrase-derived key; useless without DEK |
| **Cloudflare insider attack** (Worker injection) | Real-time data interception | Low | Targeted, per-request; would require modifying Worker code; detectable via version audit |
| **Worker code compromise** (supply chain) | Modified decryption logic | Low | Open-source code, user-deployed, can pin versions |
| **User's repo made public** | Code exposed | N/A | No secrets in repo; only code. D1/KV/R2 are per-deployment |
| **Worker cloned/forked** | Someone gets the code | N/A | Separate D1/KV per deployment; no shared data |
| **XSS in browser** | Passphrase stolen | Medium | CSP headers, HttpOnly cookies, Subresource Integrity, consider using a browser extension instead |
| **Passphrase phishing** | User gives away key | Medium | Never request passphrase outside origin; UI education |
| **Weak passphrase** | Brute-force DEK | Medium | PBKDF2 600K iterations (or Argon2id); rate-limit login attempts |
| **Quantum computer** | AES-256 broken | Very Low (decades) | AES-256 is quantum-resistant (Grover's only halves to 128-bit security); monitor post-quantum standards |
| **Device theft** | Local session hijack | Medium | Session expiry, passphrase re-entry on new device, no persistent local storage of DEK |
| **Network MITM** | Data intercepted in transit | Low | TLS 1.3 enforced by Cloudflare; additionally encrypted by our layer |
| **R2 bucket misconfiguration** | Public access to files | Low | All data encrypted; even if public, ciphertext is useless |
| **Side-channel attack on Worker** | Timing-based key extraction | Very Low | Web Crypto API uses constant-time operations; Worker isolation |

### XSS Mitigation Deep Dive

This is the weakest link since the DEK/passphrase lives in browser memory:

```
Defenses:
├── Content Security Policy (CSP) — strict, no inline scripts
├── Subresource Integrity (SRI) for all CDN assets
├── HttpOnly cookies for session tokens (passphrase never in cookie)
├── Consider browser extension architecture:
│   └── Extension runs in elevated context, harder to XSS
├── Passphrase input via dedicated modal with no third-party scripts
├── Auto-lock: DEK purged from memory after N minutes of inactivity
└── Biometric unlock (WebAuthn) as alternative to passphrase
```

---

## 7. Comparison to Existing Approaches

### vs 1Password / Bitwarden (password managers)

| Aspect | 1Password | LOG-mcp Vault |
|--------|-----------|---------------|
| Encryption | AES-256-GCM + PBKDF2 | AES-256-GCM + PBKDF2/Argon2id |
| Key derivation | PBKDF2 (~100K iterations) | PBKDF2 (600K) or Argon2id |
| Zero-knowledge | ✅ Server cannot decrypt | ⚠️ Server CAN decrypt during request (by design) |
| Data at rest | Encrypted | Encrypted |
| Threat model | Passive server | Active server (needed for API calls) |
| Secret sharing | No | Uses session key exchange |

**Key difference:** 1Password's server is truly zero-knowledge (can't decrypt ever). LOG-mcp's Worker *must* decrypt to make API calls on the user's behalf. This is an intentional trade-off for functionality.

**What we can learn:**
- Secret Key (SRP) for authentication (no sending passphrase to server)
- Browser extension for better XSS protection
- Biometric unlock via WebAuthn

### vs Signal Protocol (E2E encrypted messaging)

| Aspect | Signal | LOG-mcp Vault |
|--------|--------|---------------|
| Protocol | Signal Protocol (double ratchet) | Simpler: single DEK per session |
| Forward secrecy | ✅ Each message has unique key | ❌ Same DEK until rotation |
| Key exchange | X3DH (asynchronous) | ECIES (server has static keypair) |
| Group messaging | Sender keys | N/A |
| Zero-knowledge | ✅ Server never sees plaintext | ⚠️ Server decrypts ephemerally |

**What we can learn:**
- Consider per-session DEK rotation (derive a new DEK each login)
- X3DH-style key agreement for better forward secrecy
- Sealed sender (metadata protection)

### vs Tresorit / Cryptomator (encrypted cloud storage)

| Aspect | Tresorit | LOG-mcp Vault |
|--------|----------|---------------|
| Encryption | AES-256 + RSA for key wrap | AES-256-GCM |
| Zero-knowledge | ✅ | ⚠️ (same trade-off) |
| File handling | Client-side encrypt before upload | Same pattern |
| Collaboration | Shared keys | Single user |

**What we can learn:**
- Per-file encryption keys (wrapped with master key) for better granularity
- Client-side file preview (decrypt only what's needed)

---

## 8. Recommended Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                        BROWSER                              │
│                                                             │
│  passphrase ──→ Argon2id ──→ DEK ──┐                        │
│                                   │                        │
│  ┌─────────┐  ┌──────────┐  ┌────▼────┐  ┌──────────────┐  │
│  │ PII     │  │ Files    │  │ API     │  │ Entity Map   │  │
│  │ Scanner │  │ Encryptor│  │ Key     │  │ Tokenizer    │  │
│  └────┬────┘  └────┬─────┘  │ Encryptor│  └──────┬───────┘  │
│       │            │        └────┬────┘         │          │
│       ▼            ▼             ▼              ▼          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           AES-256-GCM Encrypt All                    │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                          │                                  │
└──────────────────────────┼──────────────────────────────────┘
                           │ HTTPS
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE EDGE                          │
│                                                             │
│  ┌──────────┐    ┌─────────┐    ┌──────────┐               │
│  │  Worker   │◄──►│   D1    │◄──►│   R2     │               │
│  │          │    │ (maps,  │    │ (files,  │               │
│  │ decrypt  │    │  keys)  │    │  photos) │               │
│  │ in memory│    │         │    │          │               │
│  └────┬─────┘    └─────────┘    └──────────┘               │
│       │                                                     │
│       │ ephemeral DEK (~3ms)                                │
│       ▼                                                     │
│  ┌──────────┐                                               │
│  │ AI API   │  OpenAI, Anthropic, etc.                     │
│  │ Provider │                                               │
│  └──────────┘                                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Key Decisions

1. **AES-256-GCM** — authenticated encryption, Web Crypto API native support
2. **Argon2id** (via WASM) or **PBKDF2 at 600K iterations** — passphrase → DEK
3. **ECIES key exchange** — browser encrypts DEK for Worker's static public key
4. **D1** for entity maps and encrypted API keys (structured queries)
5. **R2** for encrypted files/photos (object storage)
6. **KV** for fast session lookups (optional cache layer)
7. **Per-login DEK derivation** — user enters passphrase each session (or WebAuthn)
8. **Client-side NER** — PII detected and tokenized before leaving browser

### Open Questions

1. **Session persistence UX:** Re-entering passphrase every time is friction. Consider:
   - Session DEK cached in memory (tab close = lock)
   - WebAuthn/biometric as passphrase alternative
   - Encrypted session token (short-lived, decrypts DEK from storage)

2. **Multi-device:** How does a user access from phone AND laptop?
   - Separate encrypted sessions per device (simple)
   - Cross-device sync via encrypted backup key (complex, reduces security)

3. **Sharing/vault inheritance:** What if a user wants to share their vault with a trusted contact (death, emergency)?
   - Shamir's Secret Sharing to split DEK
   - Social recovery (like MetaMask)

---

## 9. Implementation Checklist

- [ ] Argon2id WASM module for browser key derivation
- [ ] Web Crypto AES-256-GCM encrypt/decrypt (browser + Worker)
- [ ] ECIES key pair generation (Worker secret, public in code)
- [ ] D1 schema: `encrypted_secrets`, `entity_maps`, `file_metadata`
- [ ] R2 bucket per-user with encrypted objects
- [ ] Client-side NER/tokenizer (regex + optional ML)
- [ ] CSP headers and SRI for XSS mitigation
- [ ] Session management with auto-lock
- [ ] Passphrase strength meter
- [ ] Rate limiting on passphrase attempts
- [ ] Audit logging (what was accessed, when — encrypted logs)

---

*Research completed 2026-03-25. This architecture provides strong privacy guarantees while enabling the core LOG-mcp functionality of AI-assisted data processing. The main trade-off vs true zero-knowledge (Signal/1Password) is that the Worker decrypts ephemerally for API calls — this is intentional and documented in the threat model.*
