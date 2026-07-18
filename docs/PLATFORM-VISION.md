# LOG.ai — Platform Vision

> **Your AI keeps a log. It remembers what you preferred, what worked, what failed.**
> **It builds a record of your judgment. And that record makes every interaction better.**
> **Your LOG is your AI's memory. Your LOG is your AI's intelligence.**

---

## The Concept: What is a LOG?

A ship's logbook records every course correction, every observation, every decision. Over a voyage, it becomes the most valuable document on board — not because it's clever, but because it's *persistent* and *contextual*. The captain doesn't reinvent navigation each morning. They read the log.

**LOG.ai is your AI logbook.** Every interaction is an entry. Every ranking, every preference, every correction is recorded. Over time, this log becomes the most valuable AI dataset you own — not because it's big, but because it's *yours*. It encodes your judgment, your domain knowledge, your standards.

Other AI platforms optimize for the average user. LOG.ai optimizes for you, because your LOG is the training data.

## The Tagline

> **Your AI has a memory. It's called a LOG.**

Or shorter: **LOG.ai — Your AI Remembers.**

---

## The Platform

### Domains as Themed Hubs

| Domain | Theme | Example Agents |
|--------|-------|---------------|
| studylog.ai | Learning & education | Tutor, Researcher, Flashcard Generator |
| makerlog.ai | Building & creating | Coder, Designer, DevOps |
| playerlog.ai | Gaming & entertainment | Strategy Advisor, Build Helper, Lore Master |
| reallog.ai | Daily life | Assistant, Planner, Finance Tracker |
| activelog.ai | Fitness & health | Workout Planner, Nutritionist, Progress Tracker |

Each domain is a themed starting point. A user picks the hub that matches their primary use case, but they can connect agents across hubs.

### User Subdomains

```
casey.makerlog.ai       → Casey's maker hub (coding, building)
casey.studylog.ai       → Casey's study hub (learning, research)
casey.reallog.ai        → Casey's daily life hub (assistant, planning)
```

Each subdomain is a fully isolated AI instance with its own:
- Encrypted database (conversations, PII maps, preferences)
- Agent registry (which agents are connected)
- Routing rules (how intents map to agents)
- Training data (draft rankings, feedback)
- Web UI (chat, settings, agent dashboard)

### The Omni-Bot

A user visits casey.makerlog.ai and sees **one chat interface**. Behind it:

```
User: "Help me debug this Python function"

casey.makerlog.ai (Omni-Bot)
  → Intent: code/debug
  → Route: local-coder (laptop, has the file)
  → If local offline: cloud-coder (makerlog.ai worker)
  → Response: "Let me look at that function..."
```

The omni-bot is a meta-agent. It classifies intent, picks the best agent (local first, cloud fallback), and returns the response. The user never thinks about which agent they're talking to — they just talk.

But they CAN. A "mode" toggle shows which agent handled each message. An "agents" panel shows all connected agents with online/offline status. A "compare" button sends the same prompt to 3 agents and lets the user pick.

### Two-Repo Architecture

```
Public Repo (github.com/casey/makerlog-public)
├── app/              ← Code (shared upstream, auto-updatable)
├── config/custom/    ← Shared personality (tutor persona, code style)
├── agents/           ← Public agents (shared with community)
├── skills/           ← Public skills (can be imported by others)
└── README.md         ← "Casey's Maker Hub"

Private Repo (github.com/casey/makerlog-private)
├── config/personal/  ← Private personality overrides
├── agents/           ← Private agents (personal tools, work-specific)
├── skills/           ← Private skills (proprietary, sensitive)
├── training/         ← Training data (draft rankings, preferences)
└── secrets/          ← Empty — actual secrets in Cloudflare, never here
```

**Public repo** = what you share. Code, personas, agents, skills that others can fork and use.

**Private repo** = what you keep. Personal agents, proprietary skills, trained routing rules, all your interaction history (encrypted in D1, not in the repo).

**Friend access** = grant a GitHub collaborator on your private repo, or issue a scoped A2A token for agent-to-agent access without repo access.

### Multi-Repo Network

A power user has separate hubs for separate contexts:

```
casey.makerlog.ai     ← Work (boss can see public repo only)
casey.studylog.ai     ← Learning (classmates can see public repo)
casey.reallog.ai      ← Personal (nobody sees private repo)
casey.family.reallog.ai ← Family hub (partner has access to private repo)
```

Cross-repo routing: from casey.reallog.ai, the omni-bot can dispatch to agents on casey.makerlog.ai. A central signing authority (`api.log.ai`) issues cross-repo tokens. Agents validate signatures. Everything is audited.

---

## The Privacy Architecture

### Zero-Knowledge at Rest

```
Browser                          Cloudflare
────────                         ──────────
User types: "Call mom at 555-0123"
    │
    ▼
Client-side NER detects: 555-0123 → [PHONE_1]
    │
    ▼
Browser encrypts entity map:
  { "[PHONE_1]": "555-0123" } → AES-256-GCM(DEK) → ciphertext
    │
    ▼
Browser sends: "Call mom at [PHONE_1]" + encrypted map
    │
    ═══ HTTPS ═══════════════════════════════════════►
    │
    ▼
Worker stores encrypted map in D1 (ciphertext only)
Worker sends "Call mom at [PHONE_1]" to AI provider
AI responds: "I'll call mom at [PHONE_1]"
    │
    ═══ HTTPS ═══════════════════════════════════════►
    │
    ▼
Browser decrypts entity map
Browser replaces [PHONE_1] → "555-0123"
User sees: "I'll call mom at 555-0123"
```

**The Worker NEVER has the plaintext phone number in persistent storage.**
**The AI provider NEVER sees the phone number.**
**If Cloudflare is compromised, all stored data is ciphertext.**

### Client-Side Encryption

- DEK derived from passphrase via PBKDF2 (600K iterations)
- ECIES session key exchange: browser encrypts DEK with Worker's static public key
- Worker holds DEK in volatile memory for session (~3ms per request)
- DEK is `extractable: false` — can't be persisted or exported
- Session auto-locks after 15 minutes idle

### What's Protected

| Data | Where Stored | Encryption |
|------|-------------|------------|
| Conversations | D1 (user's database) | AES-256-GCM (user's DEK) |
| PII entity maps | D1 | AES-256-GCM (user's DEK) |
| API keys (OpenAI, DeepSeek, etc.) | D1 | AES-256-GCM (user's DEK) |
| Uploaded files/photos | R2 | AES-256-GCM (user's DEK) |
| Training data | R2 | AES-256-GCM (user's DEK) |
| Routing rules | D1 | Encrypted or plaintext (user choice) |
| Agent configs | D1 | Encrypted or plaintext (user choice) |
| Web UI code | Cloudflare Pages | Not encrypted (it's open source) |
| User's passphrase | Never stored | Derived DEK stored in Worker memory only |

---

## The Infrastructure

### Cloudflare Stack

```
*.studylog.ai  ──►  Dispatch Worker (routes by subdomain)
                      │
                      ├──► user31.studylog.ai → User Worker 31
                      │         │
                      │         ├── D1 (tenant_31_db)
                      │         ├── KV (tenant_31_cache)
                      │         └── R2 (tenant_31_files)
                      │
                      ├──► user66.studylog.ai → User Worker 66
                      │         │
                      │         ├── D1 (tenant_66_db)
                      │         ├── KV (tenant_66_cache)
                      │         └── R2 (tenant_66_files)
                      │
                      └──► api.studylog.ai → Platform API
                                │
                                ├── User provisioning
                                ├── Agent signing authority
                                ├── Template gallery
                                └── Usage analytics (aggregate, no PII)
```

### Workers for Platforms

Cloudflare's "Workers for Platforms" is designed exactly for this:
- One Dispatch Worker handles all subdomains
- Dynamic D1/KV/R2 provisioning via REST API
- Unlimited User Workers
- Custom domains via SaaS Custom Hostnames API
- ~5-10 second onboarding time

### Scaling Tiers

| Users | Architecture | Cost |
|-------|-------------|------|
| 1-1,000 | Per-tenant D1 (full isolation) | $0/user (free tier) |
| 1,000-10,000 | Shared D1 with `tenant_id` partitioning | $0.15/user/month |
| 10,000-100,000 | Sharded D1 (regional) | $0.25/user/month |
| 100,000+ | D1 read replicas + edge caching | $0.30/user/month |

---

## The Agent Network

### Agent Identity

```
did:log:casey:makerlog:local-coder
  │     │      │          │
  │     │      │          └── Agent name
  │     │      └── Domain/hub
  │     └── User
  └── LOG.ai namespace
```

### Discovery (Layered)

1. **D1 registry** — primary: `{agent_id, capabilities, endpoint, status, last_heartbeat}`
2. **`.well-known/agent.json`** — decentralized bootstrap for cross-user discovery
3. **DNS SRV** — optional infra-level routing

### Communication

- **JSON-RPC 2.0 over HTTPS** (aligns with MCP)
- **WebSocket upgrade** for streaming responses
- **Agent handoff** — "I can't code, but my coder agent can" → automatic redirect
- **Fan-out** — "Compare these 3 agents" → parallel dispatch, aggregated response

### Local + Cloud Mix

```
Routing Rule: "code_review" intent
  → Try: coder@local (laptop) — has the files, fastest
  → Fallback: coder@cloud (makerlog.ai) — no file access, user uploads
  → Privacy lock: "medical_query" intent → local ONLY, no cloud fallback
```

### Friend Access

```
Casey grants Alex access to makerlog agent:
  - Scope: read-only conversations, can send messages
  - Duration: 7 days
  - Rate limit: 50 messages/day
  - Audit: every message logged with Alex's identity
  - Tool use: requires Casey's approval (interactive mode)
```

### Health Protocol

- **30s heartbeats** from each agent
- **90s offline threshold** → status changes to "degraded"
- **Auto-failover** to next agent by priority
- **User notification**: "Your local coder disconnected. Using cloud fallback."

---

## The Onboarding Flow (7 Commands)

```bash
# 1. Visit studylog.ai, pick your subdomain
#    (or do it from the CLI)

# 2. Create your repos
gh repo create my-studylog-public --public
gh repo create my-studylog-private --private

# 3. Clone the template
git clone https://github.com/log-ai/studylog-template.git my-studylog-public
cd my-studylog-public

# 4. Install dependencies
npm install

# 5. Provision your Cloudflare resources
npx wrangler d1 create my-studylog-db
npx wrangler kv namespace create STUDYLOG_CACHE
npx wrangler r2 bucket create my-studylog-files

# 6. Deploy
npx wrangler deploy

# 7. Open your hub
open https://casey.studylog.ai
# → Setup wizard: choose passphrase, add API keys, connect agents
```

**Total time: ~5 minutes.** (Or one-click via "Deploy to Cloudflare" button on GitHub.)

---

## The Flywheel

```
User chats with omni-bot
    │
    ▼
Omni-bot routes to best agent (based on LOG history)
    │
    ▼
Agent responds (cloud or local)
    │
    ▼
User gives feedback (thumbs up/down, rank, critique)
    │
    ▼
Feedback stored in encrypted LOG
    │
    ▼
Routing rules updated (this agent is better for this intent)
    │
    ▼
Next interaction routes better
    │
    ▼
Repeat → routing accuracy increases → API costs decrease →
local model confidence increases → fewer cloud calls → more privacy
    │
    ▼
Export training data → fine-tune local model → even better local responses
    │
    ▼
Share personality pack → new user benefits from your trained routing
    │
    ▼
Network effect: more users → more routing data → better routing for everyone
```

---

## What Makes This a Killer App

1. **$0 to start, $0.15/user/month at scale.** Cloudflare free tier is absurdly generous.

2. **Your data is mathematically private.** Client-side encryption, zero-knowledge at rest. Even we can't read it.

3. **One interface, infinite agents.** The omni-bot abstracts away the complexity. Users don't think about agents — they just talk.

4. **It actually gets better.** Not "we'll add AI to make it smarter" — the system genuinely improves from every interaction through the LOG.

5. **Fork and deploy in 5 minutes.** The repo IS the app. Your Cloudflare account IS the infrastructure. No vendor lock-in.

6. **Domain-specific hubs lower the bar.** studylog.ai isn't "yet another AI platform" — it's "an AI tutor that remembers you." makerlog.ai isn't "another coding tool" — it's "an AI pair programmer that learns your style."

7. **The network effect is real.** Personality packs spread like templates. A medical student builds a great studylog, shares it, 100 other students fork it. Each one trains it further. The platform gets better as more people use it.

8. **Local + cloud is the future.** Privacy-conscious users get off-cloud inference. Everyone else gets the speed of cloud. The system handles both transparently.

---

## Open Questions

1. **Name for the platform itself?** LOG.ai is the domain network. Is the platform also called LOG.ai? Or is there a product name? (Sieve? Prism?)
2. **Open-source vs hosted?** Is the Worker code open-source? (Probably yes — the privacy argument is stronger when users can audit it.)
3. **Revenue model?** Free for personal use. Paid for teams? Custom domains? Priority routing?
4. **Agent marketplace?** Can users sell/trade agent configurations?
5. **Data portability?** Can a user export everything and self-host without Cloudflare?
6. **Regulatory?** GDPR, CCPA — does the encryption model satisfy "right to be forgotten"?
7. **Workers AI quality?** Is it good enough as a free fallback, or does it hurt the first impression?

---

*This document lives at `.research/PLATFORM-VISION.md`. All supporting research in `.research/*/JOURNEY.md`.*
