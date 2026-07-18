# Security Model — log-origin

> Threat model, authentication, authorization, and defensive measures for the log-origin AI gateway.

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Authentication](#2-authentication)
3. [Session Management](#3-session-management)
4. [Authorization](#4-authorization)
5. [Transport Security](#5-transport-security)
6. [Worker Security](#6-worker-security)
7. [Secrets Hierarchy](#7-secrets-hierarchy)
8. [Input Validation & Sanitization](#8-input-validation--sanitization)
9. [Logging & Monitoring](#9-logging--monitoring)
10. [Friend Access](#10-friend-access)
11. [Agent-to-Agent Security](#11-agent-to-agent-security)
12. [Devil's Advocate](#12-devils-advocate)
13. [Open Questions](#13-open-questions)

---

## 1. Threat Model

### 17-Threat Matrix

| # | Threat | Impact | Likelihood | Mitigation | Owner |
|---|--------|--------|------------|------------|-------|
| 1 | **Cloudflare data breach** (D1 dump) | Encrypted data stolen | Medium | AES-256-GCM encryption at rest; ciphertext useless without DEK | Privacy |
| 2 | **Cloudflare insider attack** (Worker injection) | Real-time data interception | Low | Request-scoped DEK (~3ms); targeted interception detectable via audit | Privacy |
| 3 | **Worker code compromise** (supply chain) | Modified decryption logic | Low | Open-source, user-deployed, pinned versions, CI verification | Security |
| 4 | **XSS in browser** | Passphrase/DEK stolen | Medium | CSP headers, SRI for scripts, non-extractable CryptoKeys, auto-lock | Privacy |
| 5 | **Passphrase phishing** | User gives away passphrase | Medium | Never request passphrase outside origin; UI education; no email links | UX |
| 6 | **Weak passphrase** | Brute-force DEK | Medium | PBKDF2 600K iterations; rate limiting (5/min); strength meter | Auth |
| 7 | **CSRF on auth endpoint** | Session hijack | Medium | SameSite cookies, Origin header validation, anti-CSRF token | Auth |
| 8 | **SQL injection via D1** | Data exfiltration | Low | Drizzle ORM parameterized queries; no raw user input in SQL | Storage |
| 9 | **API key exposure in logs** | Provider keys leaked | Medium | Explicit log redaction; never log ciphertext keys | Logging |
| 10 | **Provider API key theft** (from D1) | Unauthorized API usage | Medium | AES-256-GCM encrypted in D1; decrypt only in Worker memory | Privacy |
| 11 | **Session token theft** (KV) | Impersonation | Medium | Short-lived tokens (15min); refresh rotation; secure cookies | Auth |
| 12 | **R2 bucket misconfiguration** | Public file access | Low | All data encrypted at rest; even if public, ciphertext is useless | Storage |
| 13 | **Rate limiting bypass** | Resource exhaustion | Medium | KV-based counters with sliding window; per-IP + per-user | Infra |
| 14 | **DNS rebinding** | Unauthorized Worker access | Low | Host header validation; no wildcard CORS | Transport |
| 15 | **Subrequest limit exhaustion** (Workers) | DoS via API call chaining | Low | Max 50 subrequests enforced by platform; input validation | Infra |
| 16 | **Unauthorized tunnel access** | Local instance compromise | Medium | Per-node bearer tokens; Cloudflare Access service tokens | Agent |
| 17 | **Quantum computer breaks AES-256** | All encrypted data exposed | Very Low (decades) | AES-256 quantum-resistant (Grover halves to 128-bit); monitor NIST PQC | Privacy |

### Threat Severity Summary

```
┌──────────────────────────────────────────────────┐
│                   IMPACT                          │
│                    ▲                              │
│               HIGH  │ XSS, Passphrase Theft,     │
│                     │ Key Exposure, Token Theft   │
│                     │                             │
│              MED    │ Data Breach, CSRF,          │
│                     │ SQL Injection, Rate Limit   │
│                     │                             │
│               LOW   │ Insider, Supply Chain,      │
│                     │ R2 Misconfig, DNS Rebind    │
│                     └─────────────────────►      │
│                   LOW       MEDIUM      HIGH     │
│                      LIKELIHOOD                   │
└──────────────────────────────────────────────────┘
```

---

## 2. Authentication

### Passphrase Auth (Phase 1)

```
┌──────────┐                     ┌──────────┐
│  BROWSER  │                     │  WORKER   │
└─────┬─────┘                     └─────┬─────┘
      │                                  │
      │ POST /api/auth                   │
      │ { passphrase: "..." }            │
      │ ──────────────────────────────►  │
      │                                  │
      │                         PBKDF2(passphrase, salt, 600K)
      │                                  │
      │                     HMAC-SHA256(hashed_password, server_key)
      │                                  │
      │                     Compare with stored AUTH_HASH
      │                                  │
      │  { accessToken, refreshToken }   │
      │  ◄────────────────────────────── │
      │                                  │
```

### Key derivation

- **PBKDF2** with 600,000 iterations, SHA-256, 256-bit key length
- Chosen over Argon2id: no WASM dependency, native Web Crypto support, Workers Crypto API compatible
- Salt: random 16 bytes per user, stored in `user_preferences`
- Time to derive: ~100-200ms on modern hardware (acceptable for login, not brute-forceable)

### Hash storage

- Stored as `HMAC-SHA256(PBKDF2_output, server_key)`
- `server_key` is a random 32-byte secret stored as a Worker Secret (`wrangler secret put AUTH_KEY`)
- Double-hashing: even if D1 is leaked, attacker gets HMAC output, not the raw key
- Note: for Phase 1 single-user deployments, this is adequate. Multi-user (Phase 6) should use bcrypt/argon2id via a WASM module.

### Rate limiting on auth

```
KV-based sliding window:
  Key: ratelimit:auth:{ip}
  Window: 60 seconds
  Limit: 5 attempts
  
  On failure:
    Increment counter
    If counter > 5: return 429 Too Many Requests
    Retry-After: 60 seconds
  
  On success:
    Clear counter
```

---

## 3. Session Management

### Token architecture

| Token | Lifetime | Storage | Purpose |
|-------|----------|---------|---------|
| Access token (JWT) | 15 minutes | In-memory, HttpOnly cookie | API authentication |
| Refresh token | 7 days | KV (encrypted) | Obtain new access tokens |
| Session DEK | Request-scoped | Worker memory only (~3ms) | Decrypt user data |

### JWT structure

```json
{
  "sub": "user_01JQQY6RGK",
  "iat": 1703275200,
  "exp": 1703276100,
  "jti": "01JQQY6RHM"
}
```

- Signed with HMAC-SHA256 using `JWT_SECRET` (Worker Secret)
- No sensitive data in payload (no PII, no keys)
- Short expiry (15 min) limits damage from token theft

### Refresh flow

```
Browser: POST /api/auth/refresh
  Cookie: refresh_token=<token>
    │
    ▼
Worker:
  1. Read refresh token from KV: session:{userId}:{tokenId}
  2. Verify token exists and not expired
  3. Generate new access token (JWT)
  4. Rotate refresh token (delete old, create new)
  5. Return { accessToken }
```

### Auto-lock

- Session locks after 15 minutes of inactivity (configurable via user preference)
- DEK is purged from Worker memory (isolate destroyed)
- User must re-enter passphrase to continue
- Implemented client-side: timer resets on each API call

---

## 4. Authorization

### CORS Policy

```typescript
// Default: strict (localhost only for dev)
const corsMiddleware = cors({
  origin: [
    'http://localhost:8787',   // wrangler dev
    'https://*.log-ai.com',    // production
  ],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
});
```

**Production override:** Users can set `ALLOWED_ORIGINS` env var to add their custom domain.

### CSP Headers

```
Content-Security-Policy: 
  default-src 'self';
  script-src 'self' https://unpkg.com (for Preact CDN);
  style-src 'self' 'unsafe-inline';  /* TODO: eliminate inline styles */
  img-src 'self' data: https:;
  connect-src 'self';
  frame-ancestors 'none';
  form-action 'self';
  base-uri 'self';
```

### SRI for CDN Scripts

```html
<script
  src="https://unpkg.com/preact@10.26.0/dist/preact.umd.js"
  integrity="sha384-..."
  crossorigin="anonymous"
></script>
```

All CDN-served scripts require Subresource Integrity hashes.

---

## 5. Transport Security

- **TLS 1.3** enforced by Cloudflare (no configuration needed)
- **HSTS** header: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- **No plaintext anywhere** — all API calls to providers are HTTPS
- **Additional encryption layer:** Even in transit, PII is tokenized (`[EMAIL_1]`) — the provider never sees plaintext PII

---

## 6. Worker Security

### V8 Isolate Properties

| Property | Security Implication |
|----------|---------------------|
| No filesystem access | No `/etc/passwd`, no file-based attacks |
| No persistent memory | DEK exists only for request duration |
| 128MB memory limit | Cannot load large datasets for exfiltration |
| CPU time limit (30ms paid, 10ms free) | Limits cryptographic brute-force attacks |
| 50 subrequests max | Limits SSRF and call-chain attacks |
| 1000ms wall clock (free) | Limits DoS amplification |

### Subrequest Limits

```
Per-request budget:
  Max subrequests: 50 (paid) / 50 (free)
  Max CPU time: 30,000ms (paid) / 10ms (free)
  Max wall clock: varies by plan
  
  A typical chat request uses:
  - 1x D1 read (interaction log)
  - 1x D1 write (message storage)
  - 1x KV read (session check)
  - 1x fetch (provider API call)
  = 4 subrequests, well within limits
```

### Input validation

All user inputs are validated before processing:

```typescript
// Example: chat message validation
const chatSchema = z.object({
  message: z.string().max(100_000).min(1),       // 100KB max
  sessionId: z.string().ulid(),
  model: z.string().optional(),
  stream: z.boolean().default(false),
});
```

---

## 7. Secrets Hierarchy

```
┌─────────────────────────────────────────────────────┐
│                    SECRETS HIERARCHY                  │
│                                                       │
│  Level 1: Environment Variables (highest trust)       │
│  ├── JWT_SECRET          (signs access tokens)        │
│  ├── AUTH_KEY            (HMAC server key)            │
│  └── Set via: wrangler secret put                    │
│                                                       │
│  Level 2: KV (session-scoped)                         │
│  ├── Refresh tokens      (short-lived, encrypted)     │
│  ├── Rate limit counters (ephemeral)                  │
│  └── Auto-purge via TTL                              │
│                                                       │
│  Level 3: D1 (encrypted at application layer)         │
│  ├── PII entity maps     (AES-256-GCM ciphertext)     │
│  ├── Provider API keys   (AES-256-GCM ciphertext)     │
│  └── Auth hash           (HMAC-SHA256 output)         │
│                                                       │
│  Level 4: R2 (encrypted at application layer)         │
│  ├── Training exports    (AES-256-GCM)                │
│  ├── Uploaded files      (AES-256-GCM)                │
│  └── Archive data        (AES-256-GCM)                │
└─────────────────────────────────────────────────────┘
```

**Key principle:** The Worker Secrets API is the only place plaintext secrets live. Everything else is ciphertext or derived values.

---

## 8. Input Validation & Sanitization

### Message sanitization

```typescript
function sanitizeMessage(message: string): string {
  // Remove null bytes
  let clean = message.replace(/\0/g, '');
  
  // Limit length
  if (clean.length > 100_000) {
    clean = clean.substring(0, 100_000);
  }
  
  return clean;
}
```

### SQL injection prevention

All D1 queries use Drizzle ORM with parameterized bindings. No raw user input is interpolated into SQL.

```typescript
// ✅ Safe: Drizzle parameterized
await db.select().from(sessions).where(eq(sessions.userId, userId));

// ❌ NEVER: raw interpolation
await db.run(`SELECT * FROM sessions WHERE user_id = '${userId}'`);
```

---

## 9. Logging & Monitoring

### Log redaction

All Worker logs (if enabled for debugging) are redacted before output:

```typescript
const REDACTION_PATTERNS = [
  /\b[\w.-]+@[\w.-]+\.\w{2,}\b/g,           // Email
  /\b\d{3}[-.]?\d{2}[-.]?\d{4}\b/g,          // SSN
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, // CC
  /\bsk-[a-zA-Z0-9]{20,}\b/g,                // OpenAI keys
  /\bBearer\s+\S+/g,                          // Bearer tokens
  /\[PERSON_[A-Z]+\]/g,                       // PII entity tokens
  /\[EMAIL_\d+\]/g,                           // PII email tokens
];

function redactLog(message: string): string {
  let redacted = message;
  for (const pattern of REDACTION_PATTERNS) {
    redacted = redacted.replace(pattern, '[REDACTED]');
  }
  return redacted;
}
```

### Structured logging

```json
{
  "level": "info",
  "msg": "chat_request_processed",
  "requestId": "01JQQY6RHM",
  "sessionId": "01JQQY6RGK",
  "classification": "escalation",
  "providerId": "01JQQY6RJN",
  "latencyMs": 1200,
  "tokensUsed": 450,
  "timestamp": "2026-03-25T20:00:00Z"
}
```

No PII, no API keys, no message content in logs.

---

## 10. Friend Access

### Scoped token model

When a user grants access to another user (friend), a scoped access token is issued:

```typescript
interface FriendGrant {
  id: string;              // ULID
  granterUserId: string;   // Who owns the data
  granteeUserId: string;   // Who gets access
  scope: {
    capabilities: string[];    // ['chat', 'read_sessions']
    mode: 'read-only' | 'interactive' | 'delegated';
    maxUsesPerDay: number;     // Rate limit
  };
  expiresAt: string | null;    // ISO 8601 or null (never expires)
  createdAt: string;
  revokedAt: string | null;
}
```

### Token format

```json
{
  "sub": "user_granteeId",
  "grant_id": "grant_ulid",
  "scope": ["chat", "read_sessions"],
  "mode": "interactive",
  "iat": 1703275200,
  "exp": 1703880000
}
```

Signed with the granter's `JWT_SECRET`. The friend's Worker validates the signature by checking against the granter's public key (stored in the grant record).

### Restrictions

1. **Time-limited:** Grants expire after the configured duration (default: 7 days)
2. **Capability-restricted:** Friend can only use specified capabilities
3. **Rate-limited:** Max uses per day prevents abuse
4. **Revocable:** Granter can revoke at any time; revocation propagates within 60s (KV eventual consistency)
5. **Auditable:** Every friend action is logged with grant ID

---

## 11. Agent-to-Agent Security

### Signed tokens

Agent-to-agent communication uses capability-based auth:

```
Agent A sends request to Agent B:
  Headers:
    Authorization: Bearer <agent-jwt>
    X-Agent-Id: did:log:user:domain:agent-a
    X-Capability: chat
    X-Request-Id: req-uuid
```

### Agent JWT structure

```json
{
  "sub": "did:log:casey:makerlog:coder",
  "capability": ["chat", "code", "bash"],
  "target": "did:log:casey:studylog:tutor",
  "exp": 1703278800
}
```

### Mutual verification

1. Agent B validates the JWT signature against Agent A's public key (from agent registry)
2. Agent B checks that `target` matches its own DID
3. Agent B checks that requested capabilities are in the grant scope
4. Agent B logs the interaction with both DIDs

### Capability restrictions

| Capability | Description | Risk Level |
|-----------|-------------|-----------|
| `chat` | Send messages, get responses | Low |
| `code` | Execute code, edit files | High |
| `bash` | Run shell commands | Critical |
| `read` | Read files, data | Medium |
| `admin` | Full access | Critical |

Critical capabilities require interactive mode (granter approves each use).

---

## 12. Devil's Advocate

### "PBKDF2 with 600K iterations is weak compared to Argon2id."

**Counterargument:** Argon2id is memory-hard and resistant to GPU attacks. PBKDF2 is not. 600K iterations of PBKDF2 can be computed fast on a GPU cluster.

**Rebuttal:** True — for a single-user personal deployment, PBKDF2 is adequate. The threat is someone who steals the D1 database and brute-forces the passphrase. With 600K iterations, each attempt takes ~100ms, meaning ~10 attempts/second per GPU core. For a strong passphrase (12+ chars), this is still infeasible. For Phase 1, PBKDF2 is the pragmatic choice (no WASM, native Workers Crypto support). For Phase 6 (multi-tenant), we should add Argon2id via WASM for better protection.

### "Short-lived access tokens (15 min) will frustrate mobile users."

**Counterargument:** 15 minutes is too short for a mobile session where the app goes to background frequently.

**Rebuttal:** The refresh token handles this. The access token is short-lived, but the refresh token (7 days) automatically obtains new access tokens transparently. The user only sees the passphrase prompt when the refresh token expires (7 days of inactivity). This is the standard pattern (used by Auth0, Firebase Auth, etc.).

### "CSP headers break Preact + HTM with tagged template literals."

**Counterargument:** HTM generates HTML strings at runtime, which may trigger CSP violations with `'unsafe-inline'` restrictions.

**Rebuttal:** HTM is a JavaScript library that creates DOM elements programmatically (via `document.createElement`), not via `innerHTML`. It should be CSP-compliant with `script-src 'self'`. We need to verify this during implementation and adjust CSP if needed. The inline style issue is real and should be addressed by using CSS custom properties or a style-in-JS approach that doesn't inject `<style>` tags.

### "The secrets hierarchy is overly complex for a single-user app."

**Counterargument:** A single user deploying for personal use doesn't need a 4-level secrets hierarchy. Just use Worker Secrets for everything.

**Rebuttal:** The hierarchy is designed for the full platform vision (multi-tenant, Workers for Platforms). For Phase 1, the user only interacts with Level 1 (Worker Secrets via `wrangler secret put`) and Level 3 (D1 with app-layer encryption). The hierarchy exists in the architecture so we don't need to redesign it later. The implementation is incremental — you don't build all 4 levels at once.

---

## 13. Open Questions

1. **WebAuthn/biometric unlock:** Should we support passkey authentication as an alternative to passphrase? This would eliminate the weak-passphrase threat entirely. What's the Workers Crypto API support for WebAuthn verification?

2. **Multi-device sessions:** When a user logs in from phone and laptop simultaneously, do they share the same refresh token or get separate ones? Shared tokens enable logout-all; separate tokens enable per-device control.

3. **Brute-force protection evolution:** Rate limiting by IP is weak (VPNs, botnets). Should we add CAPTCHA after N failures? Or require email verification for account recovery?

4. **Audit log retention:** How long do we keep audit logs (friend access, agent-to-agent actions)? Are they encrypted? Who can view them?

5. **Worker Secrets rotation:** How does a user rotate `JWT_SECRET` without invalidating all sessions? Should we support key rotation with a grace period?

6. **SOC2 compliance:** Is the platform targeting SOC2 certification? This would require additional controls (audit logging, access reviews, penetration testing).
