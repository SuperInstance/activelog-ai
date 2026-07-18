# Agent Interconnect: Secure Tunnels for LOG-mcp

## 1. Cloudflare Tunnel (Argo Tunnel)

### How It Works
- User runs `cloudflared tunnel` locally as a daemon
- `cloudflared` makes **outbound-only** connections to Cloudflare's edge — no inbound ports needed
- Tunnel routes traffic from a Cloudflare hostname (e.g. `local.example.com`) to `localhost:<port>` on the user's machine
- Tunnels are persistent objects mapped to DNS records via `cloudflared tunnel route dns`

### Worker → Tunnel Routing
A Cloudflare Worker **cannot directly** proxy through a named tunnel to reach a local origin. The tunnel routes traffic to a hostname, not to a Worker. However:
- **Recommended pattern:** The local instance registers a public hostname via Cloudflare Tunnel (e.g. `node-abc.log-mcp.example.com`). The Cloudflare Worker (or other services) simply makes HTTP requests to that hostname. Cloudflare routes through the tunnel automatically.
- **Alternative:** Use `cloudflared access` with `--url` to create a local-to-local proxy that the Worker can target via the Cloudflare network.

### Authentication of Incoming Requests
- The local instance should validate requests itself (bearer tokens, API keys)
- Cloudflare Access policies can add a layer on top (see below)

### Free Tier Limits
- Unlimited tunnels on the free plan (as of 2024)
- No bandwidth charge for tunnel traffic itself
- Rate limits: ~1000 connections per tunnel
- Single `cloudflared` process per tunnel (but can route multiple hostnames/services via ingress rules)

---

## 2. Cloudflare Access

### Access Policies
- Zero Trust Access policies can protect any hostname behind a tunnel
- Policies: allow by email, email domain, IP, service token, etc.
- Applies to the hostname — so any request to `node-abc.log-mcp.example.com` must pass the policy

### Service Tokens (Machine-to-Machine)
- Generate a Service Token in Cloudflare dashboard → Access → Service Tokens
- Produces a **Client ID** + **Client Secret**
- Include as headers: `CF-Access-Client-Id` + `CF-Access-Client-Secret`
- The cloud Worker uses these to authenticate to local instances
- **Limitation:** Service tokens are per-zone, not per-tunnel. You'd need one Access policy per local instance's hostname, or use a shared policy with additional app-level auth.

### Recommended Pattern for LOG-mcp
1. Each local instance creates a tunnel with a unique subdomain
2. Cloudflare Access policy on that subdomain requires Service Token + optional user email
3. Cloud Worker authenticates with Service Token when forwarding requests to local instances
4. Local instance also validates a per-node API key for defense-in-depth

---

## 3. Tailscale Integration

### Tailscale Funnel
- Exposes a local service to the public internet via a unique URL (e.g. `machine-name.tailnet-name.ts.net`)
- Uses encrypted TCP proxy through Tailscale relay servers
- Relay cannot decrypt traffic (end-to-end encryption)
- `tailscale funnel 8080` — one command to expose `localhost:8080`
- **Limitation:** Only HTTPS (443) and HTTP (80) + limited port set. No arbitrary TCP without additional setup.

### Tailscale Serve (Tailnet-only)
- Share local services only within your tailnet (private)
- More appropriate for peer-to-peer between trusted users

### Can a Cloudflare Worker Connect to a Tailscale Network?
- **No, not directly.** Workers run on Cloudflare's edge and cannot join a WireGuard/Tailscale network.
- **Workaround:** Use Tailscale Funnel to get a public URL, then have the Worker hit that URL (just like a Cloudflare Tunnel URL).
- **Better workaround for tailnet-only:** Run a small relay/proxy on a VPS that's a tailnet member and has a public IP.

### LOG-mcp Recommendation
- Support **both** Cloudflare Tunnel and Tailscale Funnel as tunnel backends
- User chooses; both produce a public HTTPS URL that the cloud instance can hit
- For peer-to-peer between users: Tailscale tailnet sharing or cloud-relayed

---

## 4. MCP (Model Context Protocol)

### Specification
- **Current version:** 2025-11-25 (modelcontextprotocol.io)
- **Protocol:** JSON-RPC 2.0 over UTF-8
- **Transports:**
  - **stdio:** Client launches server as subprocess. Messages over stdin/stdout. For local tool use (CLI tools, IDE integrations).
  - **Streamable HTTP:** Single HTTP endpoint accepting POST for messages, GET for SSE streams. Replaces the older HTTP+SSE transport. Best for remote MCP servers.

### LOG-mcp as MCP Server
Yes! LOG-mcp can expose itself as an MCP server via Streamable HTTP transport. An AI agent (Claude, GPT, etc.) connects to `https://log-mcp.example.com/mcp` and gets access to tools.

### Proposed MCP Tools for LOG-mcp
```json
{
  "tools": [
    {
      "name": "list_providers",
      "description": "List available AI providers and their status/capabilities"
    },
    {
      "name": "route_message",
      "description": "Route a chat completion request to the best provider",
      "inputSchema": { "messages": [...], "model": "optional", "preferences": {} }
    },
    {
      "name": "compare_models",
      "description": "Send same prompt to multiple models for comparison"
    },
    {
      "name": "get_routing_stats",
      "description": "Get routing decisions, latency, quality scores for recent requests"
    },
    {
      "name": "get_feedback",
      "description": "Retrieve user feedback/ratings for model outputs"
    },
    {
      "name": "register_local_node",
      "description": "Register a local inference endpoint (for self-hosted models)"
    },
    {
      "name": "sync_knowledge",
      "description": "Sync routing rules/learnings between cloud and local instances"
    }
  ]
}
```

### MCP Chaining
Yes — an AI agent connects to LOG-mcp's MCP server, which internally calls provider APIs (OpenAI, Anthropic, local models). The agent doesn't need to know about the providers. This is the core value prop.

---

## 5. A2A (Agent-to-Agent Protocol)

### Overview (a2aproject/A2A)
- Open protocol by Google for inter-agent communication
- Agents can: discover capabilities, negotiate interaction modes (text/forms/media), collaborate on long-running tasks
- Agents remain **opaque** — don't expose internal state/tools to each other
- Built for heterogeneous agents (different frameworks, companies, servers)

### Key Concepts
- **Agent Card:** JSON-LD description of an agent's capabilities (like a `.well-known` for agents)
- **Task:** Long-running unit of work with status tracking
- **Message:** Communication between agents within a task

### LOG-mcp + A2A
- LOG-mcp instances could advertise themselves via Agent Cards
- Discovery: instances query a well-known endpoint or a registry
- Collaboration: one LOG-mcp instance asks another for routing advice, model recommendations
- **Practical use:** A user's local instance asks the cloud instance "what's the best model for this task?" and the cloud answers based on aggregate data

### MCP vs A2A
- **MCP:** Client-server, tool-use focused. An AI agent uses tools on a server.
- **A2A:** Peer-to-peer, agent collaboration. Agents talk to agents as equals.
- They're complementary: LOG-mcp could be both an MCP server (for tool use) and an A2A agent (for instance-to-instance collaboration).

---

## 6. Tunnel Protocol Design

### Architecture
```
┌─────────────────┐         HTTPS          ┌─────────────────┐
│   Cloudflare    │◄──────────────────────►│   Cloudflare    │
│   Worker/GW     │                         │   Tunnel Edge   │
│   (cloud)       │                         └────────┬────────┘
└────────┬────────┘                                  │
         │                                          │ outbound
         │ HTTPS (direct to tunnel URL)             │
         │                                          ▼
         │                                  ┌────────────────┐
         │                                  │  cloudflared   │
         │                                  │  (local)       │
         │                                  └───────┬────────┘
         │                                          │
         │                                          ▼
         │                                  ┌────────────────┐
         │          HTTPS                   │ Local LOG-mcp  │
         └─────────────────────────────────►│ Instance       │
           (with Service Token auth)        │ (Jetson/laptop)│
                                            └────────────────┘
```

### Registration Flow
```
1. User starts local LOG-mcp instance
2. Local instance starts cloudflared (or tailscale funnel)
3. Local instance calls cloud API:
   POST https://api.log-mcp.com/v1/nodes/register
   {
     "node_id": "jetson-lucineer",
     "tunnel_url": "https://node-abc.log-mcp.example.com",
     "auth": { "type": "bearer", "token": "<node-api-key>" },
     "capabilities": {
       "models": ["llama3.1:70b", "mistral-nemo:12b"],
       "max_concurrent": 4,
       "gpu": "Jetson Orin"
     },
     "health_endpoint": "/health"
   }
4. Cloud validates tunnel is reachable (GET tunnel_url/health with service token)
5. Cloud responds:
   {
     "registered": true,
     "cloud_auth": { "service_token_headers": {...} },
     "heartbeat_interval_seconds": 30
   }
```

### Heartbeat / Health Check
```
# Cloud checks local instance every 30s (configurable)
GET https://node-abc.log-mcp.example.com/health
Headers:
  CF-Access-Client-Id: <service-client-id>
  CF-Access-Client-Secret: <service-client-secret>
  Authorization: Bearer <node-api-key>

Response:
{
  "status": "healthy",
  "uptime_seconds": 86400,
  "active_requests": 2,
  "available_slots": 2,
  "gpu_memory_used_pct": 67,
  "models_loaded": ["llama3.1:70b"],
  "timestamp": "2026-03-26T02:50:00Z"
}
```

### Offline Handling
1. Cloud misses 3 consecutive heartbeats → marks node `degraded`
2. Cloud misses 6 heartbeats → marks node `offline`
3. Cloud routes requests away from offline node (failover to other nodes or cloud-hosted models)
4. When node comes back: sends registration again, cloud verifies, marks `online`
5. During offline: queued requests expire after timeout; client gets 503 with retry-after header

### Request Routing (Cloud → Local)
```
POST https://node-abc.log-mcp.example.com/v1/chat/completions
Headers:
  CF-Access-Client-Id: ...
  CF-Access-Client-Secret: ...
  Authorization: Bearer <node-api-key>
  X-Request-ID: <uuid>
  X-Forwarded-For: original-client-ip
Body:
  { "model": "llama3.1:70b", "messages": [...], "stream": true }
```

### Sync Protocol (Local → Cloud)
```
POST https://api.log-mcp.com/v1/nodes/{node_id}/sync
Body:
{
  "routing_decisions": [
    { "model": "llama3.1:70b", "prompt_hash": "abc", "quality_score": 0.92, "latency_ms": 1200 }
  ],
  "feedback": [
    { "request_id": "xyz", "rating": 4, "user_notes": "good but slow" }
  ],
  "local_learnings": {
    "preferred_models": { "coding": "llama3.1:70b", "chat": "mistral-nemo:12b" }
  }
}
```

### Peer-to-Peer (Node → Node)
For users who want to share local instances:
```
# Node A asks Node B for capacity
POST https://node-b.tailnet.example.com/v1/peer/status
Headers: X-Peer-Token: <shared-secret>

# Node B responds
{
  "available": true,
  "models": ["llama3.1:70b"],
  "available_slots": 3,
  "rate_limit": "100 req/min"
}
```
Or via cloud relay (if no direct connection):
```
POST https://api.log-mcp.com/v1/peer/forward
{
  "from_node": "node-a",
  "to_node": "node-b",
  "payload": { ... }
}
```

---

## Security Considerations

### Transport Security
- All traffic over HTTPS/TLS (enforced by Cloudflare Tunnel and Tailscale)
- No plaintext anywhere in the chain

### Authentication Layers (defense-in-depth)
1. **Cloudflare Access:** Service Token required to reach tunnel hostname
2. **Node API Key:** Bearer token validated by local instance
3. **Request Signing:** Optional HMAC signature on request body for integrity
4. **Origin Validation:** MCP Streamable HTTP servers must validate Origin header

### Authorization
- Per-node API keys (not shared)
- Cloud can revoke a node's registration instantly
- Rate limiting per node to prevent abuse

### Privacy
- Local instance decides what to share (models, capabilities, routing stats)
- Sync data is opt-in per node
- Peer-to-peer requires explicit mutual consent (shared token or cloud-mediated handshake)

### DNS Rebinding Protection
- MCP servers MUST validate Origin header
- Bind to localhost when possible
- Never expose MCP endpoint on 0.0.0.0 in production

### Credential Storage
- Service Token secrets: stored in env vars, never in code
- Node API keys: generated per-node, rotatable
- Consider HashiCorp Vault or Cloudflare Secrets Store for key management

---

## Summary / Recommendations

| Need | Solution |
|------|----------|
| Cloud → Local routing | Cloudflare Tunnel or Tailscale Funnel (produces public HTTPS URL) |
| M2M auth | Cloudflare Service Tokens + per-node bearer keys |
| User-to-Local access | Cloudflare Access policies (email/SSO) |
| AI agent tool use | MCP server (Streamable HTTP) |
| Instance-to-instance collaboration | A2A protocol (agent cards + task-based messaging) |
| Offline resilience | Heartbeat-based health checks + automatic failover |
| Peer sharing | Direct (Tailscale tailnet) or cloud-relayed |

### Implementation Priority
1. **MVP:** Cloudflare Tunnel + Service Token auth + health checks
2. **v2:** MCP server interface for AI agents
3. **v3:** A2A agent cards for instance discovery + sync protocol
4. **v4:** Tailscale Funnel as alternative tunnel backend + peer-to-peer routing
