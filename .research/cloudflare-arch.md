# LOG-mcp Cloudflare Architecture Research

> Last updated: 2026-03-25
> Goal: Make LOG-mcp Cloudflare-native — fork, deploy, run.

---

## 1. Cloudflare Services Mapping

### Workers (API Gateway + Edge Logic)

**Role in LOG-mcp:** Core runtime — PII dehydration, request routing, prompt template injection, provider failover, auth middleware.

| | Free | Paid ($5/mo minimum) |
|---|---|---|
| Requests | 100,000/day | 10M/month included, +$0.30/M |
| CPU time | 10ms/invocation | 30M ms/month included, +$0.02/M ms |
| Max wall-clock | 30s (default) | 5min (up to 15min for cron/queue) |
| Script size | 1 MB (gzip) | 10 MB (gzip) |
| Subrequests | 50/invocation | 1,000/invocation |
| Memory | 128 MB | 128 MB |

**Key limits:**
- WebSocket supported (charged as 1 request for initial upgrade)
- No filesystem access (use R2 instead)
- `fetch()` subrequests don't count toward request billing
- Can import npm packages via bundling (wrangler handles this)

**Docs:** https://developers.cloudflare.com/workers/platform/pricing/
**Limits:** https://developers.cloudflare.com/workers/platform/limits/

**PII dehydration feasibility:** ✅ Perfect fit. Workers run JavaScript/TypeScript at the edge. We can run regex-based PII detection + replacement in the request pipeline before forwarding to LLM providers. 10ms CPU budget on free tier is tight for heavy NLP; on paid tier (30ms average) it's workable for regex/keyword approaches. For ML-based PII detection, use Workers AI embeddings or offload to a lightweight model.

---

### D1 (SQLite at the Edge)

**Role in LOG-mcp:** Primary database — conversation logs, user settings, prompt templates, audit trails. Direct migration path from our current SQLite.

| | Free | Paid |
|---|---|---|
| Rows read | 5M/day | 25B/month included, +$0.001/M |
| Rows written | 100K/day | 50M/month included, +$1.00/M |
| Storage | 5 GB total | 5 GB included, +$0.75/GB-mo |
| Egress | Free | Free |
| Scale-to-zero | ✅ | ✅ |

**Key details:**
- Full SQLite compatibility with some limitations (no `ATTACH DATABASE`, no loadable extensions)
- Read replicas available (no extra charge)
- `meta` object in query results includes `rows_read`/`rows_written` for cost tracking
- DDL operations count toward reads/writes
- **Max database size:** No explicit limit beyond storage billing, but 10 GB per DB is practical
- Transactions are supported
- No data transfer charges

**Migration path:** Our current SQLite schema should port directly. D1 supports `CREATE TABLE`, indexes, foreign keys, triggers. Complex queries may need optimization — full table scans count every row.

**Docs:** https://developers.cloudflare.com/d1/platform/pricing/
**Best practices:** https://developers.cloudflare.com/d1/best-practices/use-indexes/

---

### Workers KV (Key-Value Store)

**Role in LOG-mcp:** Session cache, rate limit counters, feature flags, configuration cache.

| | Free | Paid |
|---|---|---|
| Reads | 100K/day | 10M/month, +$0.50/M |
| Writes | 1K/day | 1M/month, +$5.00/M |
| Deletes | 1K/day | 1M/month, +$5.00/M |
| List | 1K/day | 1M/month, +$5.00/M |
| Storage | 1 GB | 1 GB included, +$0.50/GB-mo |

**Key limitations:**
- **Eventual consistency** — writes propagate globally within ~60 seconds
- Not suitable for data that needs strong consistency
- Max value size: 25 MB
- **DO NOT store secrets here** — KV values are accessible to any Worker bound to the namespace
- No atomic operations (use Durable Objects for that)

**Rate limiting pattern:** Use KV with `list` + `put` for simple rate limiting. For production, use Durable Objects for atomic counters.

**⚠️ Warning:** KV's eventual consistency makes it a poor fit for secrets or anything requiring immediate reads-after-writes. For secrets, use D1 (with encryption at the application layer) or Workers Secrets.

**Docs:** https://developers.cloudflare.com/kv/platform/pricing/

---

### R2 (Object Storage)

**Role in LOG-mcp:** Uploaded files (documents, images), model artifacts, training data exports, log archives.

| | Free | Paid |
|---|---|---|
| Storage | 10 GB/mo | $0.015/GB-mo |
| Class A (writes) | 1M/month | $4.50/M |
| Class B (reads) | 10M/month | $0.36/M |
| Egress | **Free** | **Free** |

**Key advantages:**
- **Zero egress fees** — unlike S3. This is a big deal for serving model artifacts.
- S3-compatible API (can use existing S3 client libraries)
- Lifecycle rules for automatic tiering
- No data transfer charges to the internet

**Use cases:**
- User-uploaded files (documents for RAG)
- Exported conversation logs
- Custom model weights / LoRA adapters
- Static assets if exceeding Pages limits

**Docs:** https://developers.cloudflare.com/r2/platform/pricing/

---

### Pages (Web UI Hosting)

**Role in LOG-mcp:** Host the admin dashboard / web UI.

| | Free | Paid |
|---|---|---|
| Requests | Unlimited (static) | Unlimited (static) |
| Bandwidth | Unlimited | Unlimited |
| Builds | 500/month | 500/month |
| Functions | Billed as Workers | Billed as Workers |
| Preview deployments | Unlimited | Unlimited |

**Key points:**
- Pages Functions are just Workers under the hood
- Can bind D1, KV, R2, Durable Objects to Pages Functions
- Supports React, Vue, Svelte, Astro, or any static framework
- Built-in CI/CD with GitHub integration
- Custom domains supported

**Architecture choice:** We could put the entire backend in Pages Functions + a static UI frontend. Or keep Workers separate and use Pages purely for static assets. Recommendation: **Pages for the UI + Pages Functions for lightweight API routes**, with a separate Worker for the heavy gateway logic (to avoid Pages Function limits).

**Docs:** https://developers.cloudflare.com/pages/platform/pricing/

---

### Cloudflare Tunnel

**Role in LOG-mcp:** Optional — let users expose their local LOG-mcp instance to the internet securely, or access on-prem LLM endpoints.

| | Free | Paid |
|---|---|---|
| Connections | Unlimited | Unlimited |
| Bandwidth | Unlimited | Unlimited |
| Tunnel names | 1 reserved per zone | Multiple |

**Key points:**
- `cloudflared tunnel` creates a secure outbound connection — no open ports needed
- Can route traffic to `localhost:8000` or any local service
- Great for development / hybrid deployments
- Not needed for a fully Cloudflare-native deployment (Workers + D1 is already edge-native)

**When useful:** Users who want to run a local Python backend but still use Cloudflare for auth/routing/DDoS protection. Or connecting to self-hosted LLM endpoints (Ollama, vLLM) behind NAT.

**Docs:** https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

---

### Durable Objects (Stateful Connections, Streaming)

**Role in LOG-mcp:** WebSocket connections for streaming LLM responses, atomic rate limit counters, session state management.

| | Free | Paid |
|---|---|---|
| Requests | 100K/day | 1M/month, +$0.15/M |
| Duration | 13,000 GB-s/day | 400K GB-s/month, +$12.50/M GB-s |
| Storage | Not available (KV backend not free) | SQLite backend available, +$0.50/GB-mo |

**Key points:**
- Only stateful primitive on Cloudflare Workers
- Each DO instance has its own storage (SQLite-backed on free plan)
- WebSocket support is first-class — keep a DO alive for the duration of a streaming connection
- 20:1 billing ratio for WebSocket messages (100 incoming WS messages = 5 billed requests)
- Perfect for: streaming SSE/WebSocket LLM responses, atomic counters, per-session state

**Streaming pattern for LLM:** 
1. Client connects to Worker
2. Worker creates/retrieves a Durable Object for the session
3. DO maintains WebSocket connection
4. DO proxies streaming response from upstream LLM provider back to client
5. DO hibernates when session ends (no billing while hibernated)

**Docs:** https://developers.cloudflare.com/durable-objects/platform/pricing/

---

## 2. Cloudflare Workers AI

### Available Models (Notable)

**Text Generation (LLMs):**
| Model | Provider | Context | Notes |
|---|---|---|---|
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Meta | 128K | Top-tier open model |
| `@cf/meta/llama-3.1-8b-instruct-fp8-fast` | Meta | 128K | Fast, good for routing/classification |
| `@cf/mistral/mistral-7b-instruct-v0.2` | Mistral | 32K | Good balance |
| `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | DeepSeek | - | Reasoning model |
| `@cf/google/gemma-2-9b-it` | Google | 8K | Small, fast |
| `kimi-k2.5` | Moonshot AI | 256K | Latest, vision + reasoning |
| `gpt-oss-120b` | OpenAI | - | Open-weight, function calling |
| `glm-4.7-flash` | Zhipu AI | 131K | Fast, 100+ languages |

**Embeddings:**
| Model | Provider | Dimensions |
|---|---|---|
| `@cf/baai/bge-large-en-v1.5` | BAAI | 1024 |
| `@cf/baai/bge-small-en-v1.5` | BAAI | 384 |
| `embeddinggemma-300m` | Google | - |

**Image Generation:**
- `@cf/stabilityai/stable-diffusion-xl-base-1.0`
- `flux-2-klein-4b`, `flux-2-dev` (Black Forest Labs)

**TTS/ASR:**
- `aura-2-en`, `aura-2-es` (Deepgram TTS)
- `flux` (Deepgram ASR)

**Docs:** https://developers.cloudflare.com/workers-ai/models/

### Pricing

| | Amount |
|---|---|
| Free tier | 10,000 Neurons/day |
| Paid | $0.011 per 1,000 Neurons |

**Cost examples (per 1M tokens):**
- Llama 3.3 70B: ~$0.293 input, ~$2.253 output
- Llama 3.1 8B: ~$0.045 input, ~$0.384 output
- Embeddings (bge-large): ~$0.014 per 1M tokens

**Docs:** https://developers.cloudflare.com/workers-ai/platform/pricing/

### API Pattern

```javascript
// In a Worker bound to AI
const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct-fp8-fast", {
  messages: [{ role: "user", content: "Hello!" }],
  stream: true, // SSE streaming supported
});

// Or use the REST API directly
// POST https://api.cloudflare.com/client/v4/accounts/{id}/ai/run/@cf/meta/llama-3.1-8b-instruct-fp8-fast
```

**Streaming:** ✅ SSE streaming supported natively. Returns a `ReadableStream`.

### Inference Latency

Workers AI runs on Cloudflare's global network. Expected latencies:
- **Small models (1-8B):** ~100-500ms first token, ~20-50ms/token generation
- **Large models (70B):** ~500-2000ms first token, ~50-100ms/token generation
- Cold start: additional ~100-300ms for serverless spin-up

**Trade-offs:** Inferior to dedicated GPU hosting (Together, Fireworks) for latency-critical apps. But:
- No GPU management overhead
- Pay-per-use, scale-to-zero
- Global edge deployment (low latency for users worldwide)

### As Fallback Provider ✅

Workers AI is an excellent fallback. If a user's primary provider (OpenAI, DeepSeek) is down or rate-limited, we can route to Workers AI as a zero-config backup. The user just needs a Cloudflare account — no additional API keys.

---

## 3. Secrets Management

### Workers Secrets (`wrangler secret put`)

```bash
wrangler secret put OPENAI_API_KEY
wrangler secret put DEEPSEEK_API_KEY
```

- Stored encrypted, accessible only by the Worker they're bound to
- Never visible in plaintext after creation
- Accessible via `env.OPENAI_API_KEY` in Worker code
- Max 100 secrets per Worker (soft limit, can be increased)
- Local dev uses `.dev.vars` file (never commit this)

**Docs:** https://developers.cloudflare.com/workers/configuration/secrets/

### Secrets Store (Beta) — Account-Level Secrets

New feature: account-level secrets that can be shared across Workers.
- Configure via binding in `wrangler.toml`
- Still encrypted at rest
- Good for sharing provider API keys across multiple Workers

**Docs:** https://developers.cloudflare.com/secrets-store/

### The Key Question: User-Managed Provider Keys Without Us Seeing Them

**Architecture pattern:**

1. **User forks repo → deploys to their own Cloudflare account**
2. **User runs `wrangler secret put OPENAI_API_KEY`** in their own terminal
3. The secret lives in **their** Cloudflare account, encrypted
4. **Our code** (the Worker) accesses it via `env.OPENAI_API_KEY`
5. We **never see** the key — it's stored in the user's account, not ours

**This is the fork-and-deploy model's killer feature.** Each user's deployment is isolated to their Cloudflare account. Their secrets are their secrets.

**UI-based secret management:**
We can build a settings page in our UI that calls the Cloudflare API to set secrets:

```javascript
// Admin endpoint in Worker — requires auth
const resp = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account_id}/workers/scripts/${script_name}/secrets`,
  {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${user_cf_api_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "OPENAI_API_KEY",
      text: "sk-...",
      type: "secret_text",
    }),
  }
);
```

**However:** This requires the user to provide a Cloudflare API token with Workers secrets edit permissions. Simpler approach: **just use `wrangler secret put` from the CLI** and document it clearly.

**Alternative: Store encrypted keys in D1**
- User enters their API key in the UI
- We encrypt it with a key derived from the user's password (client-side encryption)
- Store the encrypted blob in D1
- Decrypt at Worker runtime when making provider API calls
- We never see the plaintext key — it's encrypted before leaving the browser

**Recommendation:** Use `wrangler secret put` as the primary method (simplest, most secure). Offer the D1-encrypted-vault approach as a UI convenience for non-technical users.

---

## 4. Fork-and-Deploy Pattern

### What `npm install && wrangler deploy` Does

```
User flow:
1. Fork repo on GitHub
2. git clone their fork
3. npm install
4. npx wrangler d1 create log-mcp-db        # creates D1 database, outputs binding ID
5. npx wrangler d1 migrations apply log-mcp-db --remote  # runs schema migrations
6. npx wrangler secret put OPENAI_API_KEY     # enter their keys
7. npx wrangler deploy                         # deploys Worker globally
```

**What actually happens during `wrangler deploy`:**
1. Bundles the Worker code (TypeScript → JavaScript)
2. Uploads to Cloudflare's global network
3. Creates/replaces the Worker in the user's account
4. Binds are configured in `wrangler.toml`:
   ```toml
   [[d1_databases]]
   binding = "DB"
   database_name = "log-mcp-db"
   database_id = "<from step 4>"

   [[kv_namespaces]]
   binding = "CACHE"
   id = "<namespace-id>"

   [[r2_buckets]]
   binding = "FILES"
   bucket_name = "log-mcp-files"
   ```

### Per-User D1 Databases

Each user's fork creates **their own D1 database**. There's no multi-tenancy concern — each deployment is a separate Cloudflare account with its own D1 instance.

**Initialization flow:**
```bash
# In our repo, include:
migrations/
  0001_initial.sql    # CREATE TABLE conversations, users, settings, etc.

# User runs:
npx wrangler d1 create log-mcp-db
# Output: database_id = "abc-123..."

# Update wrangler.toml with the database_id
npx wrangler d1 migrations apply log-mcp-db --remote
```

### Customization (Branding, Models, Prompts)

**Approach 1: Environment variables in `wrangler.toml`**
```toml
[vars]
SITE_NAME = "My AI Portal"
PRIMARY_MODEL = "openai/gpt-4o"
FALLBACK_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast"
```

**Approach 2: D1 settings table**
```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- User configures via admin UI after deployment
```

**Approach 3: Config file in R2**
- User uploads `config.yaml` to R2
- Worker reads it at runtime
- Supports complex nested config

**Recommendation:** Combo of approaches 1 + 2. `wrangler.toml` vars for deployment-time settings (immutable), D1 for runtime-changeable settings (mutable via UI).

---

## 5. GitHub → Cloudflare CI/CD

### Auto-Deploy on Push to Main

**Option A: Cloudflare Pages (recommended for UI)**
- Connect GitHub repo in Cloudflare dashboard
- Auto-deploys on every push to main
- Preview deployments on every PR
- Built-in, zero config
- **Dashboard:** Pages → Create project → Connect to Git

**Option B: GitHub Actions + Wrangler**
```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- `CLOUDFLARE_API_TOKEN` is a GitHub Actions secret set by the user
- D1 migrations need a separate step:
  ```yaml
  - run: npx wrangler d1 migrations apply log-mcp-db --remote
  ```

### Keeping Forks Up to Date with Upstream

**Standard GitHub forking workflow:**
```bash
# In the user's fork:
git remote add upstream https://github.com/our-org/LOG-mcp.git
git fetch upstream
git merge upstream/main
git push origin main
# Triggers auto-deploy if CI/CD is configured
```

**Recommendation for upstream updates:**
1. **Use GitHub Actions Dependabot or Renovate** for dependency updates
2. **Document the upstream sync process** clearly in README
3. **Consider a lightweight update mechanism:**
   - Add an `/update` API endpoint to the Worker
   - It checks a version endpoint on our servers
   - Returns "update available" notification in the UI
   - User still does the git merge themselves (we can't auto-update their deployed Worker — that's a security boundary)
4. **Alternative: Use Workers KV or D1 to store config/schema version**
   - On deploy, check if migrations need to run
   - Run new migrations automatically

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                    User's Browser                        │
└──────────────┬──────────────────────┬───────────────────┘
               │ HTTPS                │ HTTPS
               ▼                      ▼
┌──────────────────────┐  ┌──────────────────────┐
│  Cloudflare Pages     │  │  Cloudflare Worker    │
│  (Static UI + SPA)    │  │  (API Gateway)        │
│                       │  │                        │
│  React/Vue/Svelte     │  │  - PII dehydration    │
│  Admin dashboard      │  │  - Auth middleware     │
│  Chat interface       │  │  - Provider routing    │
│  Settings UI          │  │  - Prompt templates    │
└───────────┬───────────┘  │  - Rate limiting       │
            │               │  - Streaming (SSE)    │
            └───────┬───────┘                        │
                    │ Bindings                        │
        ┌───────────┼───────────┬───────────┐        │
        ▼           ▼           ▼           ▼        │
   ┌────────┐ ┌──────────┐ ┌────┐ ┌──────────┐      │
   │   D1   │ │    KV    │ │ R2 │ │ Durable  │◄─────┘
   │        │ │          │ │    │ │ Objects  │
   │ SQLite │ │ Session  │ │Files│ │          │
   │ Logs   │ │ Cache    │ │Data │ │ Streaming│
   │ Config │ │ Rate     │ │Arti │ │ State    │
   │ Users  │ │ Limits   │ │fact │ │ WS conns │
   └────────┘ └──────────┘ └────┘ └──────────┘
                                         │
                                  ┌──────┴──────┐
                                  │ Providers   │
                                  │             │
                                  │ OpenAI      │
                                  │ DeepSeek    │
                                  │ Workers AI  │
                                  │ Anthropic   │
                                  │ Any REST    │
                                  └─────────────┘
```

## Cost Estimate for a Single User

| Service | Free Tier | Monthly Cost (Light Use) |
|---|---|---|
| Workers | 100K req/day | $0 (free) |
| D1 | 5M reads/day, 100K writes/day | $0 (free) |
| KV | 100K reads/day | $0 (free) |
| R2 | 10 GB, 1M writes, 10M reads/mo | $0 (free) |
| Pages | Unlimited static | $0 (free) |
| Workers AI | 10K neurons/day | $0 (free) |
| **Total** | | **$0/mo** (free tier is generous) |

**For heavier use (paid plan):**
- Workers: $5/mo base + usage
- D1: included until 25B reads or 50M writes
- Workers AI: $0.011/1K neurons beyond 10K/day free

**Bottom line:** A single user can run LOG-mcp entirely on Cloudflare's free tier for personal use. Power users might hit $5-10/mo.

## Key Risks & Gaps

1. **No Python runtime** — Workers run JavaScript/TypeScript only. Our Starlette backend must be rewritten in JS/TS or run as a separate service accessed via Tunnel.
2. **CPU time limits** — 10ms CPU per invocation on free tier is very tight for heavy processing. Paid tier gives more headroom.
3. **No persistent TCP connections** from Workers (except via Durable Objects for WebSocket). Streaming to upstream providers must use `fetch` with streaming response.
4. **D1 query performance** — high-latency queries (>30s) on free tier will hit CPU limits. Use indexes aggressively.
5. **Cold starts** — first request after inactivity has ~50-100ms overhead. Not an issue for API gateway use.

## Recommended Migration Path

1. **Phase 1:** Rewrite gateway logic in TypeScript for Workers
2. **Phase 2:** Migrate SQLite schema to D1 (mostly compatible)
3. **Phase 3:** Build admin UI as a static SPA, host on Pages
4. **Phase 4:** Implement `wrangler.toml`-driven config + D1 for runtime settings
5. **Phase 5:** Add Workers AI as fallback provider
6. **Phase 6:** Document fork-and-deploy flow, create GitHub template repo
7. **Phase 7:** Add GitHub Actions CI/CD template in `.github/workflows/`
