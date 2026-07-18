# Agent Network Architecture

> How multiple AI agents across repos, clouds, and local machines form one system a user controls through their omni-bot.

---

## 1. Agent Identity & Discovery

### Identity Schema

```
agent-did = "did:log:{user}:{domain}:{agent-name}"
           // e.g. did:log:casey:makerlog:coder

human-readable = "{agent}@{user}.{domain}.ai"
               // e.g. coder@casey.makerlog.ai
```

Each agent has a DID-like identity composed of:
- **user** — the owning human
- **domain** — which repo/cloud it belongs to
- **agent-name** — its functional role

### Discovery Stack (layered)

**Layer 1 — D1 Agent Registry (primary)**
```
CREATE TABLE agents (
  did           TEXT PRIMARY KEY,       -- did:log:casey:makerlog:coder
  address       TEXT NOT NULL,          -- https://makerlog.ai/agents/coder
  ws_endpoint   TEXT,                   -- wss://makerlog.ai/agents/coder/ws
  capabilities  TEXT NOT NULL DEFAULT '[]',  -- JSON array of skill IDs
  status        TEXT DEFAULT 'offline', -- online | offline | maintenance
  last_heartbeat INT,
  priority      INT DEFAULT 0,          -- higher = preferred for failover
  user_did      TEXT NOT NULL,          -- owning user
  created_at    INT,
  INDEX (user_did),
  INDEX (status)
);
```

The omni-bot queries: `SELECT * FROM agents WHERE user_did = ? AND status = 'online'`

**Layer 2 — .well-known/agent.json (decentralized bootstrap)**
Every agent's domain serves a discovery file:
```json
// GET https://makerlog.ai/.well-known/agent.json
{
  "version": "log-agents/1",
  "userAgents": [
    {
      "name": "coder",
      "address": "https://makerlog.ai/agents/coder",
      "capabilities": ["code", "bash", "git", "vision"],
      "auth": "bearer+mtls"
    }
  ],
  "registry": "https://api.log.ai/agents?user=casey"
}
```

**Layer 3 — DNS SRV (optional, for infra-level routing)**
```
_coder._agent.casey.makerlog.ai. SRV 10 60 443 makerlog.ai.
```
Not required but nice for edge routing.

### Capability Announcements

Agents publish a capability manifest when they register or on heartbeat:

```json
{
  "did": "did:log:casey:makerlog:coder",
  "capabilities": [
    {"id": "code", "version": 1, "tools": ["edit", "run", "test"]},
    {"id": "bash", "version": 1, "sandbox": "restricted"},
    {"id": "vision", "version": 1, "models": ["gpt-4v", "claude-3"]},
    {"id": "mcp", "version": 1, "servers": ["github", "notion"]}
  ],
  "contextWindow": 128000,
  "latencyMs": 200,
  "costPerToken": 0.00001
}
```

---

## 2. Agent Communication Protocol

### Wire Format: JSON-RPC 2.0 over HTTP/1.1 + WebSocket

**Why JSON-RPC:**
- Already the foundation of MCP
- Simple, well-understood, stateless for HTTP
- WebSocket upgrade for streaming responses

### Message Types

#### A. Omni-Bot → Agent (Task Dispatch)
```json
// POST https://makerlog.ai/agents/coder
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
      "content": "Refactor the auth module to use JWT",
      "attachments": ["log://files/auth.js"]
    },
    "context": {
      "replyTo": "telegram:8709904335",
      "urgency": "normal",
      "timeoutMs": 30000
    }
  }
}
```

#### B. Agent → Omni-Bot (Task Response)
```json
{
  "jsonrpc": "2.0",
  "id": "req-abc123",
  "result": {
    "status": "complete",
    "content": "Refactored auth.js to use JWT. Key changes:\n- ...",
    "artifacts": [
      {"type": "file", "path": "/auth.js", "diff": "..." },
      {"type": "mcp-call", "server": "github", "tool": "createPR"}
    ],
    "handoff": null
  }
}
```

#### C. Agent Handoff ("I can't do this, use this agent")
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
      "context": "User needs to research JWT best practices. Query: 'JWT vs session auth 2024'",
      "returnTo": "did:log:casey:makerlog:coder"
    }
  }
}
```

#### D. Agent ↔ Agent (Peer Collaboration)
```json
// A2A message — direct agent-to-agent, omni-bot mediates auth only
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

### Routing Logic (Omni-Bot Intent Classifier)

```
User message → Intent classifier → Agent selector

Intent categories:
  - code/edit/run → coder@* (prefer local, fallback cloud)
  - browse/search → browser@*
  - learn/explain → tutor@*
  - schedule/notify → assistant@*
  - files/local → local@laptop
  - multi-agent "compare 3 drafts" → fan-out to N agents, collect results

Agent selector algorithm:
  1. Filter agents by: user ownership, online status, capability match
  2. Score by: priority, latency, recent success rate
  3. If top agent fails → try next → notify user if fallback activates
```

---

## 3. Local + Cloud Agent Mix

### Decision Matrix

| Factor | Local (OpenClaw) | Cloud |
|--------|-------------------|-------|
| Files on disk | ✅ preferred | ❌ can't access |
| Camera/mic/hardware | ✅ only local | ❌ |
| Long-running processes | ✅ | ❌ (timeouts) |
| Web browsing | ✅ | ✅ preferred (faster) |
| Heavy compute (ML, etc.) | ❌ resource-constrained | ✅ preferred |
| Sensitive data | ✅ stays local | ⚠️ only if encrypted |
| Always-on availability | ❌ laptop sleeps | ✅ |

### Routing Decision (in omni-bot)

```python
def route(message, intent):
    candidates = get_capable_agents(intent.capability)
    
    # Prefer local for privacy-sensitive tasks
    if intent.privacy_sensitive:
        candidates = [a for a in candidates if a.is_local]
    
    # Prefer local if online, for latency
    online_locals = [a for a in candidates if a.is_local and a.status == 'online']
    if online_locals:
        return online_locals[0]
    
    # Fall back to cloud
    online_clouds = [a for a in candidates if not a.is_local and a.status == 'online']
    if online_clouds:
        notify_user("Local agent offline, using cloud fallback")
        return online_clouds[0]
    
    return None  # all offline
```

### Local → Cloud Authentication

```
1. Local OpenClaw starts → generates device keypair (Ed25519)
2. Registers with cloud registry: POST /devices { publicKey, deviceName }
3. Cloud returns: signed device certificate + tunnel token
4. All local→cloud requests include:
   - Authorization: Bearer <tunnel-token>
   - X-Device-Cert: <signed cert>
   - Mutual TLS for WebSocket connections
5. Token rotates every 24h via refresh
```

### Graceful Degradation

When local goes offline:
1. Heartbeat misses → registry marks `coder@laptop` as `offline` after 90s
2. Omni-bot's next intent classification skips local candidates
3. If user explicitly said "use my laptop coder":
   - Reply: "Your laptop coder is offline. Use cloud coder instead? (Y/n)"
4. When local comes back:
   - Registry updates → omni-bot next cycle picks it up
   - Optional: notify user "Laptop coder is back online"

---

## 4. Friend Access

### Access Grant Model

```json
// Stored in grants table
{
  "id": "grant-001",
  "granter": "did:log:casey:makerlog:coder",    // who owns the agent
  "grantee": "did:log:alex:studylog:omni",       // who's getting access
  "scope": {
    "capabilities": ["code", "bash"],            // which tools
    "mode": "interactive",                       // interactive | delegated | read-only
    "dataAccess": ["repo:casey/project-x"],      // which data repos
    "timeLimit": null,                           // or ISO timestamp
    "maxUsesPerDay": 10
  },
  "grantedAt": "2026-03-25T00:00:00Z",
  "expiresAt": null,
  "revoked": false
}
```

### Access Modes

| Mode | Description |
|------|-------------|
| **read-only** | Can query agent status, see capabilities, read public outputs |
| **interactive** | Can send messages, get responses, but every tool call requires granter approval |
| **delegated** | Can send messages + agent can use tools within scope without approval |
| **admin** | Full access (only for owner) |

### Cross-User A2A Flow

```
1. Alex's omni-bot wants to use Casey's coder agent
2. Alex's omni-bot checks grant table → finds valid grant
3. Alex's omni-bot sends task to Casey's coder:
   {
     "from": "did:log:alex:studylog:omni",
     "grantId": "grant-001",
     "message": "Help me debug this function",
     ...
   }
4. Casey's coder validates grant → scope check → executes
5. Every cross-user action logged to audit table
6. Casey sees in dashboard: "Alex used your coder at 14:32 — ran bash:ls"
```

### Audit Trail

```sql
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY,
  timestamp   INT NOT NULL,
  grant_id    TEXT,
  actor       TEXT NOT NULL,          -- who initiated
  target      TEXT NOT NULL,          -- agent that acted
  action      TEXT NOT NULL,          -- message_sent | tool_used | data_read
  detail      TEXT,                   -- what specifically
  result      TEXT,                   -- success | denied | error
  metadata    TEXT                    -- JSON extras
);
```

---

## 5. Multi-Repo Network

### Federation Model

Each repo runs its own agent registry. A **user-level federation layer** ties them together.

```
casey.makerlog.ai  → agents: [coder, browser]
casey.studylog.ai  → agents: [omni, tutor]
casey.family.ai    → agents: [assistant, photos]
casey.work.ai      → agents: [email, slack, jira]
```

### Cross-Repo Auth

```
1. User Casey has a master identity: did:log:casey:master
2. Each repo issues sub-DIDs: did:log:casey:makerlog:*, did:log:casey:studylog:*
3. Federation server (api.log.ai) holds:
   - Map of all repos for each user
   - Shared signing key for cross-repo tokens
4. Cross-repo token flow:
   - Omni-bot requests token from federation server
   - Federation server signs: {user: casey, repos: [makerlog, studylog, ...], expires: ...}
   - Agent validates token signature against federation public key
```

### Cross-Repo Message Flow

```
User: "Ask my work agent to draft an email about the Q4 review"

Omni-bot (studylog.ai):
  1. Classify intent → needs work@casey.work.ai
  2. Check: does user own work agent? → yes (from federation registry)
  3. Get cross-repo token from federation server
  4. Send to work agent:
     POST https://work.ai/agents/email
     Authorization: Bearer <federation-token>
     {
       "from": "did:log:casey:studylog:omni",
       "to": "did:log:casey:work:email",
       "message": "Draft an email about the Q4 review",
       "replyTo": "did:log:casey:studylog:omni"
     }
  5. Work agent executes → replies → omni-bot delivers to user
```

---

## 6. The Omni-Bot as Orchestrator

### Architecture

```
User ←→ Omni-Bot ←→ Agent Network
          │
          ├── Intent Classifier (LLM call)
          ├── Agent Selector (registry query + scoring)
          ├── Task Dispatcher (HTTP/WS to agent)
          ├── Response Aggregator (combine multi-agent results)
          └── Context Manager (conversation history, preferences)
```

### Orchestrator Decision Flow

```
1. USER MESSAGE ARRIVES
   ↓
2. CLASSIFY INTENT
   - Single-agent task? → go to step 3
   - Multi-agent task? → go to step 6
   - Ambiguous? → go to step 8
   ↓
3. SELECT AGENT (score + pick best)
   ↓
4. DISPATCH TASK
   ↓
5a. SUCCESS → Return response to user
5b. FAILURE → Try next agent → repeat from 4
5c. ALL FAIL → Return error: "None of your agents can do this right now"
   ↓
6. FAN-OUT (multi-agent)
   - Send to N agents in parallel
   - Collect responses (with timeout)
   ↓
7. AGGREGATE
   - Compare mode: present all, user picks
   - Merge mode: synthesize into one answer
   ↓
8. CLARIFY (ambiguous intent)
   - "Did you mean X or Y?"
   - Present options as inline buttons (Telegram)
```

### Draft Comparison Flow (Concrete UX)

```
User: "Write me a LinkedIn post about our new feature"

Omni-bot internally:
  1. Fan out to 3 agents: coder@makerlog (technical tone),
     assistant@studylog (professional), tutor@studylog (educational)
  2. Collect 3 drafts

Omni-bot to user:
  "Here are 3 options:
  
  [A] Technical — "Our latest release introduces..."
  [B] Professional — "We're excited to announce..."
  [C] Educational — "Here's what our new feature does..."
  
  Reply A, B, C, or ask for tweaks."

User: "B but make it shorter"

Omni-bot → assistant@studylog: "Revise draft B, make it 50% shorter"
→ Returns refined draft → sends to user
```

---

## 7. Agent Health & Availability

### Heartbeat Protocol

Agents POST to registry every 30 seconds:
```json
POST /agents/heartbeat
{
  "did": "did:log:casey:makerlog:coder",
  "status": "online",       // online | degraded | maintenance
  "load": 0.3,              // 0.0-1.0 CPU/memory pressure
  "queueDepth": 2,          // pending tasks
  "capabilities": ["code", "bash", "git", "vision"],  // can change dynamically
  "uptime": 86400
}
```

Registry marks agent `offline` after 3 missed heartbeats (90s).

### Status Dashboard

```
┌─────────────────────────────────────────────────┐
│  Casey's Agent Network                          │
├─────────────────────────────────────────────────┤
│  🟢 coder@laptop      — online, 45ms, load 0.1 │
│  🟢 tutor@studylog    — online, 120ms, load 0.3│
│  🟢 browser@makerlog  — online, 80ms, load 0.5 │
│  🟡 assistant@studylog — degraded, load 0.9    │
│  🔴 coder@cloud       — offline (maintenance)  │
│  🟢 email@work        — online, 200ms          │
│                                                 │
│  Cross-user grants: 2 active                    │
│  Last activity: Alex used coder 2h ago          │
└─────────────────────────────────────────────────┘
```

### Auto-Failover

```
Priority groups (same capability):
  coder@laptop    priority: 100  (preferred — low latency, local files)
  coder@cloud     priority: 50   (fallback — always-on)

Failover flow:
  1. coder@laptop heartbeat miss → status = offline
  2. Next dispatch for "code" intent → skips laptop → picks coder@cloud
  3. Omni-bot prepends to response: "⏳ Using cloud coder (your laptop is offline)"
  4. coder@laptop heartbeat resumes → status = online
  5. Next dispatch → picks laptop again
  6. No notification for return (silent)
```

### Notification on Status Change

```
Events that trigger user notification:
  - Agent goes offline (was online) → "(coder@laptop disconnected)"
  - Agent enters maintenance → "(tutor@cloud in maintenance, ETA 30min)"
  - Agent comes back after >10min outage → "(coder@laptop is back)"
  - Cross-user grant used → "(Alex used your coder just now)"
  - Anomaly (unexpected tool usage) → "(⚠️ Your email agent sent to 5 recipients)"
  
Events that do NOT trigger notification:
  - Routine online/offline transitions (<2min)
  - Heartbeat resumption within 10min
  - Normal cross-user interactions within expected scope
```

---

## Summary: Protocol Sketch

```
IDENTITY:    did:log:{user}:{domain}:{agent}
DISCOVERY:   D1 registry + .well-known/agent.json + DNS SRV (optional)
WIRE:        JSON-RPC 2.0 over HTTPS (with WebSocket upgrade for streaming)
AUTH:        Bearer token (JWT) + mutual TLS for persistent connections
FEDERATION:  Central signing authority at api.log.ai for cross-repo auth
HEARTBEAT:   30s POST to registry, 90s offline threshold
ROUTING:     Intent classifier → registry query (capability + status + priority) → dispatch
FAN-OUT:     Parallel dispatch to N agents → aggregate → present
HANDOFF:     Agent returns {status: "handoff", to: "...", context: "..."}
GRANTS:      Scoped access tokens with capability, data, time, and rate limits
AUDIT:       Every cross-user action logged with actor/target/action/result
```

### User Experience Principles

1. **One interface** — user talks to omni-bot, never thinks about which agent
2. **Transparent failover** — user is informed but never blocked
3. **Privacy by default** — local data stays local unless explicitly shared
4. **Composable** — agents combine naturally (code + browse + explain)
5. **Human-in-the-loop for cross-user** — every friend interaction is visible and auditable
6. **Graceful degradation** — system gets slower or less capable, never hard-fails
