# Protocol Specification — log-origin

> MCP (Model Context Protocol) integration, agent communication protocols,
> local instance tunnels, and cross-instance federation.

## Table of Contents

1. [MCP: Streamable HTTP Transport](#1-mcp-streamable-http-transport)
2. [MCP Tools](#2-mcp-tools)
3. [Agent Communication Protocol](#3-agent-communication-protocol)
4. [Local Instance: Tunnel & Registration](#4-local-instance-tunnel--registration)
5. [Cross-Instance Federation](#5-cross-instance-federation)
6. [Protocol Comparison Matrix](#6-protocol-comparison-matrix)
7. [Devil's Advocate](#7-devils-advocate)
8. [Open Questions](#8-open-questions)

---

## 1. MCP: Streamable HTTP Transport

### Overview

log-origin exposes an MCP server using the **Streamable HTTP** transport (spec version 2025-11-25). This allows AI agents (Claude, GPT, etc.) to connect to log-origin as a tool provider.

### Endpoint

```
POST https://your-instance.log-ai.com/mcp    → Send MCP messages
GET  https://your-instance.log-ai.com/mcp    → SSE stream for notifications
```

### Authentication

MCP clients authenticate using a bearer token issued during agent registration:

```http
POST /mcp
Authorization: Bearer mcp_<agent_token>
Content-Type: application/json
```

### Message format

All MCP communication uses JSON-RPC 2.0 (UTF-8):

```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "tools/call",
  "params": {
    "name": "route_message",
    "arguments": {
      "messages": [
        { "role": "user", "content": "Explain quantum computing" }
      ],
      "model": "auto"
    }
  }
}
```

### Connection lifecycle

```
Client                                    Server (log-origin)
  │                                           │
  │  POST /mcp                                │
  │  { jsonrpc: "2.0",                        │
  │    method: "initialize",                  │
  │    params: {                             │
  │      protocolVersion: "2025-11-25",       │
  │      capabilities: { tools: {} },        │
  │      clientInfo: {                       │
  │        name: "claude-desktop",            │
  │        version: "1.0.0"                  │
  │    }}}                                   │
  │ ──────────────────────────────────────►   │
  │                                           │
  │  { jsonrpc: "2.0",                        │
  │    id: "req-001",                         │
  │    result: {                             │
  │      protocolVersion: "2025-11-25",       │
  │      capabilities: { tools: {} },        │
  │      serverInfo: {                       │
  │        name: "log-origin",                │
  │        version: "0.1.0"                  │
  │  }}}                                     │
  │ ◄────────────────────────────────────── │
  │                                           │
  │  POST /mcp                                │
  │  { method: "notifications/initialized" }  │
  │ ──────────────────────────────────────►   │
  │                                           │
  │  [Normal tool calls...]                   │
  │                                           │
```

### SSE stream (for long-running operations)

For operations like `compare_models` or `manage_session` that take time, the client can open an SSE stream:

```http
GET /mcp
Authorization: Bearer mcp_<agent_token>
Accept: text/event-stream
```

```
event: message
data: {"jsonrpc":"2.0","id":"req-002","result":{"status":"draft_round_complete","drafts":[...]}}

event: message
data: {"jsonrpc":"2.0","method":"notifications/routing_update","params":{"rule_id":"...","confidence":0.85}}
```

---

## 2. MCP Tools

### 2.1 `route_message`

Route a chat completion request through log-origin's intelligent routing.

```json
{
  "name": "route_message",
  "description": "Route a chat completion request to the best AI provider based on message classification.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "messages": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "role": { "type": "string", "enum": ["system", "user", "assistant"] },
            "content": { "type": "string" }
          },
          "required": ["role", "content"]
        }
      },
      "model": {
        "type": "string",
        "enum": ["auto", "cheap", "escalation", "local"],
        "default": "auto"
      },
      "session_id": { "type": "string", "description": "Optional session for context" },
      "max_tokens": { "type": "integer", "default": 4096 },
      "temperature": { "type": "number", "default": 0.7 }
    },
    "required": ["messages"]
  }
}
```

**Response:**
```json
{
  "content": "Quantum computing uses qubits that can exist in superposition...",
  "model": "deepseek-chat",
  "provider": "DeepSeek",
  "route": {
    "action": "cheap",
    "confidence": 0.9,
    "rule": "simple_qa",
    "latency_ms": 800
  },
  "usage": { "prompt_tokens": 120, "completion_tokens": 350 }
}
```

### 2.2 `compare_models`

Send the same prompt to multiple providers for comparison.

```json
{
  "name": "compare_models",
  "description": "Send the same prompt to multiple AI providers and return all responses for comparison.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "messages": { "type": "array", "description": "Messages to send" },
      "providers": {
        "type": "array",
        "items": { "type": "string" },
        "description": "Provider IDs to include (empty = all enabled)"
      }
    },
    "required": ["messages"]
  }
}
```

**Response:**
```json
{
  "drafts": [
    { "provider": "DeepSeek", "content": "...", "latency_ms": 1200 },
    { "provider": "Groq (Llama)", "content": "...", "latency_ms": 350 }
  ]
}
```

### 2.3 `get_feedback_stats`

Get aggregate feedback statistics.

```json
{
  "name": "get_feedback_stats",
  "description": "Get aggregate feedback statistics including provider performance and routing accuracy.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "period": { "type": "string", "enum": ["24h", "7d", "30d", "all"], "default": "30d" },
      "group_by": { "type": "string", "enum": ["provider", "action", "rule"], "default": "provider" }
    }
  }
}
```

**Response:**
```json
{
  "total_interactions": 500,
  "feedback_rate": 0.35,
  "positive_rate": 0.78,
  "by_provider": [
    { "provider": "DeepSeek", "total": 300, "positive": 240, "avg_latency_ms": 900 },
    { "provider": "Groq", "total": 200, "positive": 140, "avg_latency_ms": 200 }
  ]
}
```

### 2.4 `submit_feedback`

Submit feedback on a specific interaction.

```json
{
  "name": "submit_feedback",
  "description": "Submit thumbs up/down feedback on a specific interaction.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "interaction_id": { "type": "string" },
      "rating": { "type": "string", "enum": ["up", "down"] },
      "critique": { "type": "string", "description": "Optional explanation" }
    },
    "required": ["interaction_id", "rating"]
  }
}
```

### 2.5 `get_routing_info`

Get current routing rules and their performance.

```json
{
  "name": "get_routing_info",
  "description": "Get current routing rules, their hit counts, and performance metrics.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "include_learned": { "type": "boolean", "default": true }
    }
  }
}
```

**Response:**
```json
{
  "rules": [
    { "name": "code_generation", "pattern": "\\bwrite\\b.*\\bfunction\\b", "action": "escalation", "confidence": 0.85, "hits": 45, "source": "static" },
    { "name": "learned_code_0", "pattern": "\\brefactor\\b", "action": "escalation", "confidence": 0.72, "hits": 12, "source": "learned", "enabled": true }
  ]
}
```

### 2.6 `manage_session`

Create, retrieve, or manage chat sessions.

```json
{
  "name": "manage_session",
  "description": "Create, retrieve, list, or delete chat sessions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["create", "get", "list", "delete", "update_title"] },
      "session_id": { "type": "string" },
      "title": { "type": "string" },
      "cursor": { "type": "string" },
      "limit": { "type": "integer", "default": 20 }
    }
  }
}
```

---

## 3. Agent Communication Protocol

### Overview

Agent-to-agent communication uses JSON-RPC 2.0 over HTTPS with optional WebSocket upgrade for streaming.

### Wire format

```
JSON-RPC 2.0 over HTTP/1.1:
  POST https://agent-endpoint/agent
  Content-Type: application/json
  Authorization: Bearer <agent-jwt>
  X-Agent-Id: did:log:user:domain:agent-name
  X-Request-Id: req-uuid

  {
    "jsonrpc": "2.0",
    "id": "req-abc123",
    "method": "agent.task",
    "params": { ... }
  }

WebSocket upgrade for streaming:
  GET wss://agent-endpoint/agent/ws
  Authorization: Bearer <agent-jwt>
  X-Agent-Id: did:log:user:domain:agent-name
```

### Message types

#### Task dispatch (omni-bot → agent)

```json
{
  "jsonrpc": "2.0",
  "id": "req-abc123",
  "method": "agent.task",
  "params": {
    "from": "did:log:casey:studylog:omni",
    "to": "did:log:casey:makerlog:coder",
    "conversationId": "conv-xyz",
    "message": {
      "role": "user",
      "content": "Refactor the auth module to use JWT"
    },
    "context": {
      "replyTo": "telegram:8709904335",
      "urgency": "normal",
      "timeoutMs": 30000
    }
  }
}
```

#### Task response (agent → omni-bot)

```json
{
  "jsonrpc": "2.0",
  "id": "req-abc123",
  "result": {
    "status": "complete",
    "content": "Refactored auth.js to use JWT. Key changes:\n- ...",
    "artifacts": [
      { "type": "file", "path": "/auth.js", "diff": "..." },
      { "type": "mcp-call", "server": "github", "tool": "createPR" }
    ],
    "handoff": null
  }
}
```

#### Agent handoff

```json
{
  "jsonrpc": "2.0",
  "id": "req-abc123",
  "result": {
    "status": "handoff",
    "content": "I can't browse the web, but I've prepared the search query. Handing off to browser agent.",
    "handoff": {
      "to": "did:log:casey:studylog:browser",
      "reason": "capability_required:web_browse",
      "context": "User needs to research JWT best practices.",
      "returnTo": "did:log:casey:makerlog:coder"
    }
  }
}
```

#### Peer collaboration (agent ↔ agent, mediated by omni-bot)

```json
{
  "jsonrpc": "2.0",
  "id": "a2a-def456",
  "method": "agent.collaborate",
  "params": {
    "from": "did:log:casey:makerlog:coder",
    "to": "did:log:casey:studylog:browser",
    "taskId": "req-abc123",
    "request": "Search for JWT best practices and return the top 3 articles",
    "replyTo": "did:log:casey:makerlog:coder"
  }
}
```

---

## 4. Local Instance: Tunnel & Registration

### Overview

Local instances (Jetson, laptop, home server) connect to the cloud via Cloudflare Tunnel (or Tailscale Funnel). The cloud routes requests to local instances through the tunnel.

### Registration flow

```
┌────────────────┐          HTTPS          ┌────────────────┐
│ Local Instance │                         │ Cloud Worker   │
│ (Jetson/laptop)│                         │                │
└───────┬────────┘                         └───────┬────────┘
        │                                          │
        │ 1. Start cloudflared (or tailscale)      │
        │    → tunnel URL: https://node-abc...     │
        │                                          │
        │ 2. POST /api/nodes/register              │
        │ ──────────────────────────────────────►  │
        │    {                                      │
        │      "node_id": "jetson-lucineer",        │
        │      "tunnel_url": "https://node-abc...",│
        │      "auth": {                            │
        │        "type": "bearer",                  │
        │        "token": "<node-api-key>"          │
        │      },                                   │
        │      "capabilities": {                    │
        │        "models": ["llama3.1:70b"],       │
        │        "max_concurrent": 4,               │
        │        "gpu": "Jetson Orin"               │
        │      },                                   │
        │      "health_endpoint": "/health"         │
        │    }                                      │
        │                                          │
        │ 3. Cloud validates tunnel reachability    │
        │    GET tunnel_url/health                  │
        │    (via Cloudflare Tunnel automatically)  │
        │ ◄─────────────────────────────────────── │
        │                                          │
        │ 4. { registered: true,                   │
        │      cloud_auth: { ... },                │
        │      heartbeat_interval_s: 30 }           │
        │ ◄─────────────────────────────────────── │
        │                                          │
```

### Health check protocol

Cloud checks local instance every 30 seconds:

```http
GET https://node-abc.log-ai.com/health
CF-Access-Client-Id: <service-client-id>
CF-Access-Client-Secret: <service-client-secret>
Authorization: Bearer <node-api-key>
```

**Response:**
```json
{
  "status": "healthy",
  "uptime_seconds": 86400,
  "active_requests": 2,
  "available_slots": 2,
  "gpu_memory_used_pct": 67,
  "models_loaded": ["llama3.1:70b"],
  "timestamp": "2026-03-25T20:00:00Z"
}
```

### Heartbeat from local to cloud

```http
POST https://api.log-ai.com/api/nodes/heartbeat
Authorization: Bearer <node-api-key>
Content-Type: application/json

{
  "node_id": "jetson-lucineer",
  "status": "online",
  "load": 0.3,
  "queue_depth": 2,
  "capabilities": ["code", "bash", "vision"],
  "uptime": 86400
}
```

### Offline thresholds

| Event | Trigger | Action |
|-------|---------|--------|
| Missed 1 heartbeat | 30s | No action |
| Missed 3 heartbeats | 90s | Status → `degraded` |
| Missed 6 heartbeats | 180s | Status → `offline` |
| Recovery | Heartbeat received | Status → `online` (immediate) |

### Offline handling

- Requests routed away from offline node (failover to cloud or other local)
- Queued requests expire with `503 Service Unavailable` + `Retry-After: 60`
- No data loss: requests are processed by fallback, not queued indefinitely

### Request routing (cloud → local)

```http
POST https://node-abc.log-ai.com/v1/chat/completions
CF-Access-Client-Id: <service-client-id>
CF-Access-Client-Secret: <service-client-secret>
Authorization: Bearer <node-api-key>
X-Request-ID: req-uuid
Content-Type: application/json

{
  "model": "llama3.1:70b",
  "messages": [
    { "role": "user", "content": "Write a Python function..." }
  ],
  "stream": true
}
```

### Sync protocol (local → cloud)

Local instances can sync routing learnings back to the cloud:

```http
POST https://api.log-ai.com/api/nodes/{node_id}/sync
Authorization: Bearer <node-api-key>

{
  "routing_decisions": [
    {
      "model": "llama3.1:70b",
      "prompt_hash": "abc",
      "quality_score": 0.92,
      "latency_ms": 1200
    }
  ],
  "feedback": [
    {
      "request_id": "xyz",
      "rating": 4,
      "user_notes": "good but slow"
    }
  ]
}
```

---

## 5. Cross-Instance Federation

### Identity

Each instance has a cryptographic identity:

```
Agent DID: did:log:casey:makerlog:coder
Ed25519 Keypair:
  - Private key: stored locally, never transmitted
  - Public key: published in agent registry
```

### Session key establishment

For cross-instance communication, a session key is derived:

```
Instance A                        Instance B
  │                                  │
  │  1. Fetch B's public key         │
  │     from registry                 │
  │ ◄────────────────────────────── │
  │                                  │
  │  2. Derive shared secret:        │
  │     X25519(myPrivKey, theirPubKey)│
  │                                  │
  │  3. Encrypt request with         │
  │     AES-256-GCM(sessionKey)      │
  │ ──────────────────────────────►  │
  │                                  │
  │  4. B decrypts, processes,       │
  │     encrypts response            │
  │ ◄────────────────────────────── │
```

### Scoped permissions

Cross-instance access is limited to explicitly granted capabilities:

```json
{
  "grant_id": "grant-001",
  "from_instance": "did:log:alex:studylog:omni",
  "to_instance": "did:log:casey:makerlog:coder",
  "capabilities": ["code", "bash"],
  "mode": "interactive",
  "max_requests_per_hour": 50,
  "expires_at": "2026-04-01T00:00:00Z"
}
```

### Request signing

All cross-instance requests are signed:

```http
POST https://casey.makerlog.ai/agents/coder
Authorization: Bearer <federation-jwt>
X-Agent-Id: did:log:alex:studylog:omni
X-Grant-Id: grant-001
X-Signature: ed25519-signature
Content-Type: application/json
```

The signature covers: `method + path + body_hash + timestamp` to prevent replay attacks.

### Federation token

Cross-repo tokens are issued by a central signing authority (`api.log.ai`):

```json
{
  "sub": "did:log:alex:studylog:omni",
  "repos": ["makerlog", "studylog"],
  "capabilities": ["chat", "read"],
  "exp": 1703880000,
  "iss": "api.log.ai"
}
```

Signed with the federation's Ed25519 key. Agents validate the signature against the federation's public key.

---

## 6. Protocol Comparison Matrix

| Aspect | MCP (Streamable HTTP) | Agent JSON-RPC | Cloudflare Tunnel |
|--------|----------------------|----------------|-------------------|
| **Purpose** | Tool use (AI → gateway) | Agent-to-agent tasks | Cloud → local routing |
| **Transport** | HTTP POST/SSE | HTTP + WebSocket upgrade | HTTPS via tunnel |
| **Auth** | Bearer token | JWT + Ed25519 signature | Service token + bearer |
| **Direction** | Client → Server | Bidirectional | Server → Client (via tunnel) |
| **Latency** | ~50-200ms | ~100-300ms | ~200-500ms (tunnel overhead) |
| **Streaming** | SSE | WebSocket | HTTP streaming |
| **Discovery** | Manual (URL) | DID-based registry | Registration flow |
| **State** | Stateless | Stateful (conversation) | Stateless per request |

### Protocol stack diagram

```
┌──────────────────────────────────────────────────────┐
│                    USER'S BROWSER                     │
│  ┌──────────────────────────────────────────────┐    │
│  │  Chat UI (Preact)                            │    │
│  └──────────┬──────────────────┬────────────────┘    │
└─────────────┼──────────────────┼─────────────────────┘
              │ HTTPS            │ SSE
              ▼                  ▼
┌──────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKER (log-origin)           │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ /v1/chat │  │   /mcp   │  │ /api/nodes/*     │   │
│  │ REST API  │  │ MCP Srv  │  │ Agent Registry   │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────────────┘   │
│       │              │              │                  │
│       │  ┌───────────┴──────────────┘                 │
│       │  │                                          │
│  ┌────▼──▼────┐     ┌──────────────┐                 │
│  │ Providers  │     │ Agent Network│                 │
│  │ (OpenAI,   │     │ JSON-RPC 2.0 │                 │
│  │  DeepSeek, │     │              │                 │
│  │  Groq)     │     │  ┌────────┐  │                 │
│  └────────────┘     │  │ Ed25519│  │                 │
│                     │  │ X25519 │  │                 │
│                     │  └────────┘  │                 │
│                     └──────┬───────┘                 │
│                            │                          │
└────────────────────────────┼──────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
       ┌────────────┐ ┌──────────┐  ┌──────────┐
       │ Cloudflare │ │ Instance │  │ Instance │
       │ Tunnel     │ │ A (local)│  │ B (peer) │
       │            │ │ Jetson   │  │ Laptop   │
       └─────┬──────┘ └────┬─────┘  └────┬─────┘
             │              │             │
             ▼              ▼             ▼
       ┌──────────┐ ┌──────────┐  ┌──────────┐
       │ cloudflared│ │ Local AI │  │ Local AI │
       │ daemon   │ │ (Ollama) │  │ (Ollama) │
       └──────────┘ └──────────┘  └──────────┘
```

---

## 7. Devil's Advocate

### "MCP is too new and unstable for production use."

**Counterargument:** The MCP spec is still evolving. The Streamable HTTP transport is new (2025-11-25). Building against it risks breaking when the spec changes.

**Rebuttal:** MCP is the right bet because it's gaining rapid adoption (Claude Desktop, Windsurf, etc.). The tool interface is simple (6 tools) and the transport is standard HTTP — easy to adapt if the spec changes. We wrap the MCP interface around our existing REST API, so the core logic doesn't depend on MCP stability. If MCP changes, we update the wrapper, not the engine.

### "JSON-RPC 2.0 for agent communication is outdated."

**Counterargument:** gRPC, GraphQL, or even raw HTTP would be more modern choices. JSON-RPC lacks streaming (without WebSocket upgrade), type safety, and code generation.

**Rebuttal:** JSON-RPC is chosen deliberately because: (1) it's the foundation of MCP, ensuring compatibility, (2) it's human-readable and debuggable (important for a self-hosted tool), (3) it works over standard HTTP without special infrastructure, (4) the agent communication layer is thin — 4 message types don't justify the complexity of gRPC. For performance-critical paths, WebSocket upgrade provides streaming.

### "Cloudflare Tunnel adds 200-500ms latency for local inference."

**Counterargument:** Running inference locally defeats the purpose if the tunnel adds significant latency. Users would be better off running a direct API.

**Rebuttal:** 200-500ms is the *tunnel* latency (TLS termination + routing). The inference itself takes 500-5000ms depending on the model. So the tunnel overhead is a small fraction of total latency. For comparison, a cloud API call (OpenAI) typically takes 1000-3000ms including network latency. Local inference via tunnel is competitive. If latency becomes a concern, Tailscale Funnel (which uses a more direct path) is the alternative.

### "Ed25519 identity for cross-instance federation is overkill."

**Counterargument:** For a personal tool, a simple shared secret between instances is sufficient. Ed25519 keypairs, DID-based identity, and session key derivation are enterprise-grade complexity.

**Rebuttal:** The federation system is designed for the platform vision (Phase 7). For Phase 5 (single local instance), the auth is simply a bearer token. The Ed25519 identity exists in the architecture so that when federation is needed, the identity system is already in place. The incremental cost is minimal: generate a keypair during setup, publish the public key in the registry.

---

## 8. Open Questions

1. **MCP tool versioning:** How do we version MCP tools? If `route_message` changes its schema, how do we maintain backward compatibility with existing MCP clients?

2. **Agent WebSocket reconnection:** What's the reconnection strategy when a WebSocket drops? Exponential backoff? What happens to in-flight requests?

3. **Tunnel DNS propagation:** When a local instance registers a new tunnel, DNS propagation can take seconds. Should we cache the tunnel URL and retry on failure?

4. **Cross-instance encryption overhead:** Ed25519 signing and X25519 key exchange add ~5ms per request. Is this acceptable for cross-instance calls, or should we cache session keys?

5. **Federation authority trust model:** Who runs `api.log.ai`? If it's us, that's a central point of trust. If it's decentralized, how do we bootstrap trust?

6. **Tailscale Funnel support timeline:** Tailscale Funnel is listed as an alternative tunnel backend. What's the implementation priority relative to other Phase 5 features?

7. **MCP notification delivery:** How do we push notifications (routing updates, new draft rounds) to MCP clients that only use HTTP POST (no SSE stream open)?
