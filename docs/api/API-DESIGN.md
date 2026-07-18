# API Design — log-origin

> HTTP API specification for the log-origin AI gateway. OpenAI-compatible with extensions.

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Authentication](#2-authentication)
3. [OpenAI Compatibility Layer](#3-openai-compatibility-layer)
4. [Extension Object (_meta)](#4-extension-object-_meta)
5. [Endpoints](#5-endpoints)
6. [Request/Response Schemas](#6-requestresponse-schemas)
7. [SSE Streaming](#7-sse-streaming)
8. [Error Format](#8-error-format)
9. [Rate Limits](#9-rate-limits)
10. [Devil's Advocate](#10-devils-advocate)
11. [Open Questions](#11-open-questions)

---

## 1. Design Principles

| Principle | Implementation |
|-----------|---------------|
| **OpenAI-compatible** | Primary endpoint (`/v1/chat/completions`) matches OpenAI API format |
| **Extensions via `_meta`** | log-origin additions live in a `_meta` sub-object, never polluting top-level |
| **Strict mode header** | `X-LogOrigin-Mode: strict` strips all extensions for strict OpenAI clients |
| **Cursor pagination** | All list endpoints use cursor-based pagination |
| **JSON error envelope** | Consistent error format across all endpoints |
| **Bearer token auth** | Standard `Authorization: Bearer <token>` header |

---

## 2. Authentication

All `/api/` and `/v1/` endpoints (except `/api/auth`) require authentication.

### Request

```http
POST /v1/chat/completions
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
Content-Type: application/json
```

### Auth endpoints (no token required)

```http
POST /api/auth          # Login with passphrase
POST /api/auth/refresh  # Refresh access token
```

### Token lifecycle

```
1. POST /api/auth { passphrase } → { accessToken, refreshToken }
2. Use accessToken in Authorization header (expires in 15 min)
3. When accessToken expires → POST /api/auth/refresh → new accessToken
4. When refreshToken expires (7 days) → user re-enters passphrase
```

---

## 3. OpenAI Compatibility Layer

### Primary endpoint

```
POST /v1/chat/completions
```

This endpoint is **drop-in compatible** with the OpenAI API. Any client built for OpenAI works with log-origin without modification.

### What's compatible

- Request format: `{ model, messages, stream, max_tokens, temperature }`
- Response format: `{ id, object, created, model, choices, usage }`
- Streaming: SSE with `data: { ... }` and `data: [DONE]`
- Error format: `{ error: { type, code, message } }`

### What's extended

log-origin adds a `_meta` object to responses (see Section 4). Strict OpenAI clients that don't understand extra fields can use the `X-LogOrigin-Mode: strict` header to suppress extensions.

### Strict mode

```http
POST /v1/chat/completions
X-LogOrigin-Mode: strict
Authorization: Bearer <token>

# Response will be identical to OpenAI's format — no _meta, no extensions
```

---

## 4. Extension Object (_meta)

The `_meta` object carries log-origin-specific metadata. It is:

- **Nested under `choices[0].message._meta`** for chat completions
- **Nested under `._meta`** at the response root for non-chat endpoints
- **Never in the top level** of the response (avoids breaking OpenAI client parsing)

### Example

```json
{
  "id": "chatcmpl-01JQQY6RGK",
  "object": "chat.completion",
  "created": 1703275200,
  "model": "deepseek-chat",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I'll draft an email to [EMAIL_1] about the invoice.",
        "_meta": {
          "route": {
            "action": "cheap",
            "confidence": 0.8,
            "rule": "summarization",
            "provider_id": "01JQQY6RJN",
            "latency_ms": 1200
          },
          "pii": {
            "detected": 1,
            "tokens": ["[EMAIL_1]"],
            "rehydration_required": true
          },
          "interaction_id": "01JQQY6RHM",
          "cached": false
        }
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 45,
    "total_tokens": 195
  }
}
```

### `_meta` fields

| Field | Type | Description |
|-------|------|-------------|
| `route.action` | string | Routing action used (cheap, escalation, etc.) |
| `route.confidence` | number | Router confidence (0.0–1.0) |
| `route.rule` | string | Name of the matching rule (or "default") |
| `route.provider_id` | string | ULID of the provider that handled the request |
| `route.latency_ms` | number | End-to-end latency in milliseconds |
| `pii.detected` | number | Count of PII entities detected |
| `pii.tokens` | string[] | List of PII tokens in the message |
| `pii.rehydration_required` | boolean | Whether browser should rehydrate tokens |
| `interaction_id` | string | ULID for this interaction (used for feedback) |
| `cached` | boolean | Whether the response was served from cache |

---

## 5. Endpoints

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth` | No | Login with passphrase |
| `POST` | `/api/auth/refresh` | No* | Refresh access token |
| `POST` | `/api/auth/logout` | Yes | Invalidate tokens |

### Chat (OpenAI-compatible)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/chat/completions` | Yes | Send message, get completion |
| `POST` | `/v1/chat/completions` (stream) | Yes | SSE streaming response |

### Sessions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/sessions` | Yes | List sessions (cursor-paginated) |
| `POST` | `/api/sessions` | Yes | Create new session |
| `GET` | `/api/sessions/:id` | Yes | Get session with messages |
| `PATCH` | `/api/sessions/:id` | Yes | Update session (title, metadata) |
| `DELETE` | `/api/sessions/:id` | Yes | Delete session and all messages |

### Feedback

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/feedback` | Yes | Submit thumbs up/down on interaction |
| `GET` | `/api/feedback/stats` | Yes | Get feedback statistics |

### Draft (Multi-provider comparison)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/draft` | Yes | Run draft round (parallel provider execution) |
| `POST` | `/api/draft/:roundId/winner` | Yes | Select winner for a draft round |

### Providers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/providers` | Yes | List configured providers |
| `POST` | `/api/providers` | Yes | Add a provider (encrypted key) |
| `PATCH` | `/api/providers/:id` | Yes | Update provider config |
| `DELETE` | `/api/providers/:id` | Yes | Remove provider |

### Routing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/routing/rules` | Yes | List routing rules |
| `POST` | `/api/routing/rules` | Yes | Create custom routing rule |
| `PATCH` | `/api/routing/rules/:id` | Yes | Update routing rule |
| `DELETE` | `/api/routing/rules/:id` | Yes | Delete routing rule |

### Preferences

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/preferences` | Yes | Get all user preferences |
| `PUT` | `/api/preferences/:key` | Yes | Set a preference |

### PII

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/pii/entities` | Yes | List PII entities (decrypted in browser) |
| `DELETE` | `/api/pii/entities/:id` | Yes | Delete a PII entity |

### Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/admin/stats` | Yes | Usage statistics |
| `GET` | `/api/admin/export` | Yes | Export all user data |
| `DELETE` | `/api/admin/account` | Yes | Delete account (GDPR) |

### MCP & Agents

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/mcp` | Agent | MCP Streamable HTTP endpoint |
| `GET` | `/mcp` | Agent | MCP SSE stream |
| `POST` | `/api/nodes/register` | Agent | Register local instance |
| `POST` | `/api/nodes/heartbeat` | Agent | Agent heartbeat |
| `GET` | `/api/nodes` | Yes | List registered agents |

**Total: 28 endpoints**

---

## 6. Request/Response Schemas

### POST /api/auth

**Request:**
```json
{
  "passphrase": "my-secret-passphrase"
}
```

**Response (200):**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "rt_01JQQY6RGK",
  "expires_in": 900,
  "user_id": "user_01JQQY6RGK"
}
```

**Response (401):**
```json
{
  "error": {
    "type": "authentication_error",
    "code": "invalid_passphrase",
    "message": "Passphrase is incorrect"
  }
}
```

---

### POST /v1/chat/completions

**Request:**
```json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Email [EMAIL_1] about the invoice" }
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "stream": false,
  "session_id": "01JQQY6RGK",
  "_meta": {
    "force_provider": "01JQQY6RJN"
  }
}
```

**Response (200):**
```json
{
  "id": "chatcmpl-01JQQY6RHM",
  "object": "chat.completion",
  "created": 1703275200,
  "model": "deepseek-chat",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "I'll draft an email to [EMAIL_1] about the invoice. Here's a draft:\n\n---\nSubject: Invoice #INV-12345\n\nDear [EMAIL_1],\n\nI hope this message finds you well. I'm writing regarding invoice #INV-12345...",
        "_meta": {
          "route": {
            "action": "escalation",
            "confidence": 0.75,
            "rule": "creative_writing",
            "provider_id": "01JQQY6RJN",
            "latency_ms": 1850
          },
          "pii": {
            "detected": 1,
            "tokens": ["[EMAIL_1]"],
            "rehydration_required": true
          },
          "interaction_id": "01JQQY6RHM",
          "cached": false
        }
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 180,
    "total_tokens": 330
  }
}
```

---

### POST /api/draft

**Request:**
```json
{
  "messages": [
    { "role": "user", "content": "Write a blog post about AI privacy" }
  ],
  "session_id": "01JQQY6RGK",
  "providers": ["01JQQY6RJN", "01JQQY6RJP", "01JQQY6RJR"]
}
```

**Response (200):**
```json
{
  "round_id": "01JQQY6RHS",
  "status": "complete",
  "drafts": [
    {
      "provider_id": "01JQQY6RJN",
      "provider_name": "DeepSeek",
      "model": "deepseek-chat",
      "content": "AI privacy is one of the most...",
      "latency_ms": 1200,
      "tokens": { "prompt": 50, "completion": 200 }
    },
    {
      "provider_id": "01JQQY6RJP",
      "provider_name": "Groq (Llama)",
      "model": "llama-3.1-70b",
      "content": "In the age of artificial intelligence...",
      "latency_ms": 350,
      "tokens": { "prompt": 50, "completion": 180 }
    },
    {
      "provider_id": "01JQQY6RJR",
      "provider_name": "Workers AI",
      "model": "llama-3.3-70b",
      "content": "Privacy and AI: A modern dilemma...",
      "latency_ms": 2800,
      "tokens": { "prompt": 50, "completion": 220 }
    }
  ],
  "created_at": "2026-03-25T20:00:00Z"
}
```

---

### GET /api/sessions

**Request:**
```
GET /api/sessions?cursor=eyJjcmVhdGVkX2F0Ijoi...&limit=20
```

**Response (200):**
```json
{
  "data": [
    {
      "id": "01JQQY6RGK",
      "title": "Invoice email draft",
      "message_count": 5,
      "last_message_at": "2026-03-25T20:00:00Z",
      "created_at": "2026-03-25T18:30:00Z",
      "metadata": {}
    }
  ],
  "pagination": {
    "next_cursor": "eyJjcmVhdGVkX2F0IjoiMjAyNi0wMy0yNVQxODowMDowMFoiLCJpZCI6IjAxSlFRWTVSR0sifQ",
    "has_more": true
  }
}
```

---

### POST /api/feedback

**Request:**
```json
{
  "interaction_id": "01JQQY6RHM",
  "rating": "up",
  "critique": "Good draft, but make it more concise"
}
```

**Response (200):**
```json
{
  "id": "01JQQY6RHT",
  "interaction_id": "01JQQY6RHM",
  "rating": "up",
  "created_at": "2026-03-25T20:01:00Z"
}
```

---

### POST /api/providers

**Request (API key encrypted client-side):**
```json
{
  "type": "openai-compatible",
  "name": "My DeepSeek",
  "base_url": "https://api.deepseek.com",
  "api_key": "base64-encoded-aes-256-gcm-ciphertext",
  "model": "deepseek-chat",
  "roles": ["cheap", "escalation"],
  "max_tokens": 4096,
  "temperature": 0.7
}
```

> Note: The `api_key` field contains ciphertext encrypted with the user's DEK. The Worker stores it as-is in D1 and decrypts only when making API calls.

**Response (201):**
```json
{
  "id": "01JQQY6RJN",
  "type": "openai-compatible",
  "name": "My DeepSeek",
  "base_url": "https://api.deepseek.com",
  "model": "deepseek-chat",
  "roles": ["cheap", "escalation"],
  "enabled": true,
  "health_status": "healthy",
  "created_at": "2026-03-25T20:00:00Z"
}
```

> Note: The response does NOT include `api_key` (ciphertext or otherwise).

---

## 7. SSE Streaming

### Request

```http
POST /v1/chat/completions
Authorization: Bearer <token>
Content-Type: application/json

{
  "model": "deepseek-chat",
  "messages": [...],
  "stream": true
}
```

### Response format

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"id":"chatcmpl-01JQQY6RHM","object":"chat.completion.chunk","created":1703275200,"model":"deepseek-chat","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

data: {"id":"chatcmpl-01JQQY6RHM","object":"chat.completion.chunk","created":1703275200,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"I'll"},"finish_reason":null}]}

data: {"id":"chatcmpl-01JQQY6RHM","object":"chat.completion.chunk","created":1703275200,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":" draft"},"finish_reason":null}]}

data: {"id":"chatcmpl-01JQQY6RHM","object":"chat.completion.chunk","created":1703275200,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":" an email"},"finish_reason":null}]}

data: {"id":"chatcmpl-01JQQY6RHM","object":"chat.completion.chunk","created":1703275200,"model":"deepseek-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop","_meta":{"route":{"action":"escalation","confidence":0.75,"provider_id":"01JQQY6RJN","latency_ms":1850},"interaction_id":"01JQQY6RHM"}}}

data: [DONE]
```

### Event types

| Event | Description |
|-------|-------------|
| `data: {...}` | Completion chunk (OpenAI-compatible format) |
| `data: [DONE]` | Stream complete |
| `event: error\ndata: {...}` | Stream error (connection to provider failed) |

### Error during streaming

```
event: error
data: {"error":{"type":"server_error","code":"provider_timeout","message":"Provider did not respond within 30 seconds"}}
```

---

## 8. Error Format

### Envelope

```json
{
  "error": {
    "type": "<error_type>",
    "code": "<machine_readable_code>",
    "message": "<human_readable_message>",
    "details": {} // optional, for validation errors
  }
}
```

### Error types

| Type | HTTP Status | Codes |
|------|-------------|-------|
| `authentication_error` | 401 | `invalid_token`, `token_expired`, `invalid_passphrase` |
| `permission_error` | 403 | `insufficient_scope`, `friend_access_revoked` |
| `not_found` | 404 | `session_not_found`, `provider_not_found`, `interaction_not_found` |
| `validation_error` | 422 | `invalid_request`, `missing_field`, `invalid_field_value` |
| `rate_limit_error` | 429 | `too_many_requests`, `auth_rate_limit` |
| `provider_error` | 502 | `provider_unavailable`, `provider_timeout`, `provider_auth_failed` |
| `server_error` | 500 | `internal_error`, `encryption_error`, `database_error` |

### Validation error example

```json
{
  "error": {
    "type": "validation_error",
    "code": "invalid_field_value",
    "message": "Validation failed",
    "details": {
      "fields": {
        "message": "Must be between 1 and 100000 characters",
        "temperature": "Must be between 0.0 and 2.0"
      }
    }
  }
}
```

---

## 9. Rate Limits

| Endpoint | Limit | Window | Scope |
|----------|-------|--------|-------|
| `POST /api/auth` | 5 | 1 minute | Per IP |
| `POST /api/auth/refresh` | 30 | 1 minute | Per IP |
| `POST /v1/chat/completions` | 60 | 1 minute | Per user |
| `POST /v1/chat/completions` (stream) | 10 | 1 minute | Per user |
| `POST /api/draft` | 5 | 1 hour | Per user |
| `GET /api/*` | 120 | 1 minute | Per user |
| `POST /api/*` | 60 | 1 minute | Per user |
| `DELETE /api/*` | 10 | 1 minute | Per user |
| `POST /mcp` | 30 | 1 minute | Per agent token |

Rate limit headers are included in all responses:

```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1703275260
```

When rate limited:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1703275260
```

---

## 10. Devil's Advocate

### "The _meta object will break OpenAI client libraries."

**Counterargument:** Many OpenAI client libraries are strict about response schema. Extra fields in `choices[0].message` may cause deserialization errors.

**Rebuttal:** This is a real risk. The `X-LogOrigin-Mode: strict` header addresses it for clients that the user controls. For third-party clients that the user can't configure, we need a different approach. Options: (1) put `_meta` at the response root instead of inside `message`, (2) use a custom HTTP header for metadata, (3) provide a dedicated `/v1/chat/completions` wrapper that guarantees strict compatibility. For Phase 1, the `strict` header is sufficient because the primary client is our own web UI.

### "28 endpoints is too many for a personal tool."

**Counterargument:** A simple chat gateway needs maybe 5 endpoints: auth, chat, sessions, feedback, settings. The rest is scope creep.

**Rebuttal:** True for Phase 1. But the API is designed for the full platform vision. The endpoint list is the target state. Phase 1 implements only: auth (3), chat (1), sessions (5), feedback (2), providers (2 — list + add), and preferences (1). That's 14 endpoints for MVP — manageable. The rest are added incrementally.

### "SSE streaming through Workers has limitations."

**Counterargument:** Workers have a CPU time limit (10ms free, 30ms paid). Long-running SSE connections may time out.

**Rebuttal:** Workers don't enforce wall-clock limits on streaming responses. The CPU time limit only counts time the Worker is actively processing (not waiting for upstream). So a 30-second stream from the provider uses near-zero CPU time on the Worker. The real limit is Durable Objects for WebSocket connections (which we use for persistent connections). SSE is fine for request-response streaming.

---

## 11. Open Questions

1. **Batch API:** Should we support `POST /v1/chat/completions` with an array of messages for batch processing? Useful for training data export and offline analysis.

2. **WebSocket endpoint:** Should we offer a persistent WebSocket connection for real-time chat instead of SSE? This would enable server-initiated messages (notifications, agent updates).

3. **API versioning:** Should the API have a version prefix beyond `/v1/`? How do we handle breaking changes?

4. **Webhook support:** Should users be able to configure webhooks for events (feedback submitted, routing rule created, provider health change)?

5. **CORS for MCP clients:** MCP Streamable HTTP clients may send `Origin` headers from arbitrary origins. How do we validate these without being too restrictive?

6. **Pagination consistency:** When using cursor-based pagination with KV-cached data, there may be consistency issues if data is written between page fetches. Is this acceptable for a personal tool?
