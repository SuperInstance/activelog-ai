# THE PLAN — Personal AI Gateway Platform

> A forkable, Cloudflare-native, privacy-first AI gateway that learns from your choices.
> Fork the repo. Deploy to your Cloudflare account. Your data, your models, your rules.

---

## The Vision (One Paragraph)

A user forks our repo on GitHub, connects it to their Cloudflare account with seven commands, and has a private AI portal running on their own domain. They add their API keys through the web UI (encrypted client-side, stored in their Cloudflare D1 — we never see them). They chat with AI, compare responses from multiple providers side-by-side, and rank them. The system learns their preferences and routes better over time. They can optionally connect a local instance (Jetson, laptop, home server) via Cloudflare Tunnel for private local inference. When they've trained and customized their instance for a specific use case (medical research, legal docs, coding), they export a "personality pack" — just config and training data, zero personal info — and share it as a forkable template for others. **The repo is the app. Their Cloudflare account is the infrastructure. Their judgment is the training data.**

## The Name

**TBD** — current candidates: Sieve, Prism, OwnGate, Bastion, Sanctum, Relay
Decision: pick after architecture is finalized. The name should emerge from what it does, not what we think sounds cool.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    USER'S BROWSER                         │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Web App (Cloudflare Pages)                         │ │
│  │  - Chat UI                                          │ │
│  │  - Draft comparison cards                           │ │
│  │  - Settings / provider keys                         │ │
│  │  - Client-side encryption (AES-256-GCM)             │ │
│  └─────────────┬───────────────────────────────────────┘ │
└────────────────┼────────────────────────────────────────┘
                 │ HTTPS
                 ▼
┌─────────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKERS (Edge)                    │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │   Auth   │  │   PII    │  │  Route   │  │ Draft  │  │
│  │  (JWT)   │→ │  Strip   │→ │ Decision │→ │ Split  │  │
│  └──────────┘  └──────────┘  └────┬─────┘  └────────┘  │
│                                    │                     │
│  ┌─────────────────────────────────▼──────────────────┐ │
│  │              Provider Layer                         │ │
│  │  DeepSeek │ Groq │ OpenAI │ Workers AI │ Local*    │ │
│  └────────────────────────────────────────────────────┘ │
│                                    │                     │
│  ┌──────────┐  ┌──────────┐  ┌─────▼─────┐            │
│  │  PII     │  │  Cache   │  │  Learn    │            │
│  │ Restore  │  │  (KV)    │  │ (routes)  │            │
│  └──────────┘  └──────────┘  └───────────┘            │
└────────────────┬────────────────────────────────────────┘
                 │
    ┌────────────┼────────────────┐
    │            │                │
    ▼            ▼                ▼
┌────────┐  ┌────────┐  ┌──────────────┐
│  D1    │  │   KV   │  │     R2       │
│ SQLite │  │ Cache  │  │ Files, Models│
│ Encrypted│ │ Tokens │  │ Training Data│
│ PII Map │  │ Config │  │ Photos      │
└────────┘  └────────┘  └──────────────┘

    * Local instance via Cloudflare Tunnel
```

### Cloudflare Services Used

| Service | Purpose | Free Tier |
|---------|---------|-----------|
| Workers | API logic, routing, PII strip/restore | 100K req/day |
| D1 | Encrypted PII map, conversations, settings | 5 GB, 5M reads/day |
| KV | Session cache, rate limits, config | 100K reads/day |
| R2 | Uploaded files, training exports, model artifacts | 10 GB |
| Pages | Web UI hosting | 500 builds/mo, unlimited bandwidth |
| Tunnel | Connect to local instances | Unlimited |
| Workers AI | Fallback models (zero-config) | 10K neurons/day |

**Cost: $0/month for personal use.** All within free tier limits.

---

## Three-Layer Repo Architecture

```
your-fork/
├── app/                    # ← LAYER 1: Code (shared, upstream-updatable)
│   ├── worker/             #   Cloudflare Workers (TypeScript)
│   │   ├── src/
│   │   │   ├── index.ts    #   Entry point
│   │   │   ├── router.ts   #   Request routing
│   │   │   ├── pii.ts      #   PII dehydration/rehydration
│   │   │   ├── routing.ts  #   Model selection logic
│   │   │   ├── draft.ts    #   Draft comparison
│   │   │   ├── learn.ts    #   Feedback → routing rules
│   │   │   ├── tunnel.ts   #   Local instance management
│   │   │   ├── mcp.ts      #   MCP server tools
│   │   │   └── crypto.ts   #   Client-side encryption helpers
│   │   └── wrangler.toml
│   ├── web/                #   Frontend (Cloudflare Pages)
│   │   ├── index.html
│   │   ├── app.js
│   │   ├── crypto.js       #   Client-side encryption
│   │   └── styles.css
│   └── migrations/         #   D1 schema migrations
│       ├── 001_initial.sql
│       └── 002_draft_ranking.sql
│
├── config/                 # ← LAYER 2: Personality (sharable as template)
│   ├── default/            #   Base defaults (committed)
│   │   ├── theme.json      #   Colors, fonts, layout
│   │   ├── personality.md  #   System prompt, tone, behavior
│   │   ├── features.yaml   #   Feature flags and toggles
│   │   └── routing.json    #   Default routing rules
│   └── custom/             #   User overrides (committed, promoted as template)
│       ├── theme.json      #   Custom colors
│       ├── personality.md  #   Custom AI behavior
│       └── routing.json    #   Custom routing rules
│
├── .github/                # ← CI/CD
│   └── workflows/
│       └── deploy.yml      #   Auto-deploy on push to main
│
├── README.md               #   Onboarding flow
├── .env.example            #   Reference (secrets go to Cloudflare, not here)
├── wrangler.toml           #   Cloudflare config (committed, no secrets)
└── .gitattributes          #   Merge strategy (app/ = theirs, config/custom/ = ours)
```

**Key principle:** `config/custom/` is the only layer the user edits to personalize. `app/` always merges from upstream. `config/default/` provides fallbacks.

### .gitattributes (conflict-free upstream updates)

```
app/         merge=theirs    # Upstream code always wins
config/default/ merge=theirs # Default config updates flow in
config/custom/ merge=ours    # User customizations always win
```

This means `git merge upstream/main` never creates conflicts.

---

## The Privacy Model

### Encryption Flow

```
SETUP (once per session):
1. User enters passphrase in browser
2. Browser derives DEK: PBKDF2(passphrase, salt, 600K iterations, SHA-256)
3. Browser generates ephemeral ECDH keypair
4. Browser encrypts DEK with Worker's static public key (ECIES)
5. Browser sends encrypted DEK to Worker
6. Worker decrypts DEK, stores in memory (extractable: false)
7. DEK lives for the session duration, never persisted

STORING PII:
1. User types message with "email me at john@example.com"
2. Browser NER detects PII: "john@example.com" → [EMAIL_1]
3. Browser encrypts entity map: { "[EMAIL_1]": "john@example.com" } → ciphertext
4. Browser sends: message with [EMAIL_1] + encrypted entity map
5. Worker stores encrypted entity map in D1 (ciphertext, never plaintext)

API CALL:
1. Worker receives message with [EMAIL_1]
2. Worker sends to provider (PII never leaves)
3. Provider responds: "I'll email [EMAIL_1]"
4. Worker returns response as-is to browser

REHYDRATION (browser-side):
1. Browser receives "I'll email [EMAIL_1]"
2. Browser decrypts entity map using session DEK
3. Browser replaces [EMAIL_1] → "john@example.com"
4. User sees: "I'll email john@example.com"
```

**Critical insight:** The Worker NEVER has the plaintext PII entity map in persistent storage. It holds the DEK in volatile memory for the session, but the encrypted map in D1 is useless without it. If Cloudflare is compromised, all stored data is ciphertext.

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| Cloudflare DB leak | All PII encrypted at rest — ciphertext useless without DEK |
| Worker memory dump | DEK is `extractable: false`, Worker isolate destroyed after request |
| Repo made public | No secrets in repo — all in Cloudflare Secrets API |
| XSS steals passphrase | CSP headers, SRI for scripts, auto-lock after 15min idle |
| MITM on API call | HTTPS everywhere, provider API keys encrypted in D1 |
| Worker logs sensitive data | Explicit log redaction for PII tokens and API keys |
| Branch promotion leaks data | config/custom/ contains no PII — only personality/config |
| Local instance compromise | Tunnel uses service tokens, per-node bearer auth |

---

## Phased Plan

### Phase 1: Rewrite for Cloudflare Workers (TypeScript)
**Goal:** Working AI gateway on Cloudflare edge with single-provider support.

- [ ] Port Python logic to TypeScript (routing, PII, draft comparison)
- [ ] Set up Workers + D1 + KV + Pages in new repo
- [ ] Basic chat endpoint with DeepSeek integration
- [ ] PII dehydration/rehydration at the edge
- [ ] Auth (JWT, passphrase login)
- [ ] Web UI (chat interface)
- [ ] `wrangler deploy` works from fork
- **Deliverable:** User can fork, deploy, chat with AI, PII is stripped

### Phase 2: Multi-Provider + Draft Comparison
**Goal:** The "aha moment" — compare models side-by-side.

- [ ] Provider registry: DeepSeek, Groq, OpenAI, Workers AI (zero-config fallback)
- [ ] API key management through web UI (encrypted, stored in D1)
- [ ] Draft mode: send to 3 providers, show cards, user picks winner
- [ ] Feedback loop: rankings update routing rules
- [ ] Workers AI as free fallback (no keys needed to start)
- **Deliverable:** User compares DeepSeek vs Groq vs Workers AI, picks winners, routing improves

### Phase 3: Privacy Vault + Client-Side Encryption
**Goal:** Zero-knowledge at rest. Users trust the system with sensitive data.

- [ ] Client-side encryption library (Web Crypto API)
- [ ] ECIES session key exchange
- [ ] Encrypted PII entity maps in D1
- [ ] Encrypted API keys in D1
- [ ] Browser-side PII detection (NER)
- [ ] File upload → encrypt → R2 → decrypt for vision APIs
- [ ] Setup wizard: passphrase → derive keys → confirm
- **Deliverable:** User can share credit card numbers, medical info, photos. Nothing stored in plaintext.

### Phase 4: Self-Improvement Loop
**Goal:** The system demonstrably gets better from usage.

- [ ] Routing rules optimizer (from draft rankings)
- [ ] Visible learning dashboard ("Your feedback has saved $X and improved accuracy by Y%")
- [ ] Semantic cache (embedding similarity in Workers AI or local)
- [ ] Training data export (LoRA/DPO JSONL from draft rankings)
- [ ] Dataset quality scoring (effort, diversity, consistency)
- **Deliverable:** After 50+ rankings, user sees measurable improvement in routing quality

### Phase 5: Local Instance + Tunnels
**Goal:** Connect to local hardware for private inference.

- [ ] Cloudflare Tunnel integration (auto-register local node)
- [ ] Local instance discovery and health checking (30s heartbeats)
- [ ] Route requests to local models when available
- [ ] Fallback: local → cloud when local goes offline
- [ ] MCP server exposure (tools: route_message, compare_models, get_stats)
- [ ] Tailscale Funnel support as alternative tunnel
- **Deliverable:** User runs local GGUF model on Jetson, Cloudflare routes to it via tunnel

### Phase 6: Forkable Platform + Personality Packs
**Goal:** Users share their tuned instances as templates.

- [ ] Three-layer repo structure (app/config-custom/config-default)
- [ ] .gitattributes merge strategy for conflict-free updates
- [ ] No-code customization: theme.json, personality.md, features.yaml
- [ ] Personality pack export (config + training rules, zero personal data)
- [ ] Template gallery: "Medical AI Gateway", "Legal Research Assistant", "Code Review Bot"
- [ ] One-click fork-and-deploy from template
- [ ] Upstream sync mechanism (weekly merge from upstream/main)
- **Deliverable:** User A builds a medical AI gateway, shares as template, User B forks and has a running instance in 5 minutes

### Phase 7: Agent Network + A2A
**Goal:** Instances discover and learn from each other.

- [ ] A2A protocol for instance-to-instance communication
- [ ] Peer discovery (opt-in directory)
- [ ] Federated learning: share routing rules without sharing personal data
- [ ] Agent marketplace: specialized instances offer their routing expertise
- [ ] Cross-instance draft comparison (your instance + a medical specialist instance)
- **Deliverable:** Ecosystem of specialized, interoperable AI gateways

---

## What Makes This a Killer App

1. **Zero cost to start.** Free Cloudflare tier. Workers AI has real models for free. No credit card.

2. **Zero trust required.** Client-side encryption. We can't see your data. Cloudflare can't see your data. Even if the repo goes public, nothing leaks.

3. **The repo IS the product.** Fork it. Customize it. Deploy it. Share it. This is how open source spreads — not as a library to integrate, but as a complete product you own.

4. **The flywheel actually closes.** Use → compare → rank → route better → use more. Most "AI platforms" have a broken loop. This one has feedback at every step.

5. **Workers AI is the unlock.** Zero-config AI from day one. No API keys to start. Compare Workers AI vs DeepSeek vs Groq. The draft comparison sells itself.

6. **Personality packs spread like templates.** A doctor builds a medical AI assistant, shares it, 100 other doctors fork it. Each one trains it on their own usage. The network effect isn't the code — it's the accumulated routing intelligence.

7. **Privacy is the wedge.** Every AI tool asks you to trust them with your data. This one mathematically can't. In a post-ChatGPT world where everyone's worried about AI data harvesting, this is the differentiator.

---

## Immediate Next Steps

1. **Pick a name** (with research complete, the architecture should inform this)
2. **Create a new repo** (clean start, TypeScript, Cloudflare-native from day one)
3. **Phase 1 implementation** — the TypeScript rewrite is the critical path
4. **Existing LOG-mcp code as reference** — all the logic is tested and proven, just needs porting
5. **Document everything** — the research JOURNALS are the design docs for implementation
