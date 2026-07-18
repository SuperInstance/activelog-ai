# LOG.ai Multi-Tenant Cloudflare Architecture

## Executive Summary

**Cloudflare Workers for Platforms** is the exact product for this use case. It provides per-customer isolated Workers with their own D1/KV/R2 bindings, custom domains/subdomains, and a dispatch router pattern. However, there are critical limits that shape the architecture decisions below.

---

## 1. Multi-Tenant Architecture on Cloudflare

### The Answer: Workers for Platforms + Hybrid Isolation

Cloudflare's **Workers for Platforms** is purpose-built for multi-tenant platforms. It provides:

- **Dispatch Namespace**: A container for all tenant Workers
- **Dispatch Worker**: A router that routes requests to the correct tenant Worker based on hostname
- **User Workers**: Per-tenant isolated Workers with their own bindings (D1, KV, R2, DO)
- **Custom limits**: Per-tenant CPU time and subrequest caps
- **Observability**: Cross-tenant log/metric aggregation

```
┌─────────────────────────────────────────────────────────┐
│                    *.studylog.ai                        │
│              (Wildcard DNS → CF Zone)                    │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│              DISPATCH WORKER (Router)                    │
│         Reads hostname → extracts tenant_id             │
│         Routes to User Worker via dispatch namespace    │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ casey    │ │ maker31  │ │ player7  │
   │ Worker   │ │ Worker   │ │ Worker   │
   │          │ │          │ │          │
   │ ├─ D1    │ │ ├─ D1    │ │ ├─ D1    │
   │ ├─ KV    │ │ ├─ KV    │ │ ├─ KV    │
   │ └─ R2    │ │ └─ R2    │ │ └─ R2    │
   └──────────┘ └──────────┘ └──────────┘
```

### Per-Tenant vs Shared Resources

| Resource | Per-Tenant (Isolated) | Shared (with tenant_id) | Recommendation |
|----------|----------------------|------------------------|----------------|
| D1 Database | ✅ Recommended | Possible but weaker isolation | **Per-tenant** — true isolation, required for E2E encryption |
| KV Namespace | ✅ Recommended | Possible | **Per-tenant** — session cache, rate limits should be isolated |
| R2 Bucket | ✅ Recommended | Possible with prefixes | **Per-tenant** — file isolation |
| Worker | ✅ Required | N/A | **Per-tenant** — Workers for Platforms model |
| Pages Deployment | Shared via routing | ✅ One deployment, hostname routing | **Shared** — the UI code is identical, dispatch Worker routes |

### Dynamic Provisioning via API

All resources can be created via the Cloudflare API (requires an API token with appropriate permissions):

**Create D1 Database:**
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"name": "tenant-casey-studylog", "primary_region": "auto"}'
# Returns: { "result": { "uuid": "...", "name": "...", "created_at": "..." } }
```

**Create KV Namespace:**
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{"title": "tenant-casey-studylog"}'
# Returns: { "result": { "id": "...", "title": "..." } }
```

**Create R2 Bucket:**
```bash
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/tenant-casey-studylog" \
  -H "Authorization: Bearer {api_token}"
```

**Create User Worker (via Workers for Platforms dispatch):**
```bash
# Deploy user worker script to dispatch namespace
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/dispatch/namespaces/{dispatch_ns}/scripts/{tenant_id}" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/javascript" \
  --data-binary @worker.js \
  -F "metadata={\"main_module\": \"worker.js\", \"bindings\": [
    {\"type\": \"d1\", \"name\": \"DB\", \"id\": \"{d1_uuid}\"},
    {\"type\": \"kv\", \"name\": \"CACHE\", \"namespace_id\": \"{kv_id}\"},
    {\"type\": \"r2\", \"name\": \"FILES\", \"bucket_name\": \"tenant-casey-studylog\"}
  ]}"
```

### Critical Limits (as of current Cloudflare docs)

| Resource | Free Plan | Workers Paid |
|----------|-----------|--------------|
| D1 databases per account | 10 | **50,000** |
| D1 max database size | 500 MB | **10 GB** |
| D1 total storage per account | 5 GB | **1 TB** |
| D1 queries per Worker invocation | 50 | 1,000 |
| Workers per account | 100 | **500** (or unlimited with Workers for Platforms) |
| Worker CPU time | 10 ms | 30 sec (max 5 min) |
| KV namespaces | 100 | **Unlimited** (paid) |
| Subrequests per request | 50 | 10,000 |

**⚠️ The 500 Worker limit on Workers Paid requires Workers for Platforms to exceed.** With Workers for Platforms, you can deploy unlimited User Workers.

---

## 2. Subdomain Routing

### How It Works

1. `*.studylog.ai` has a wildcard DNS record in the Cloudflare zone (AAAA/CNAME to `192.168.1.1` or CF proxy)
2. All subdomain traffic hits the **Dispatch Worker**
3. Dispatch Worker parses `hostname`: `casey.studylog.ai` → tenant_id = `casey`
4. Dispatch Worker routes to the User Worker for `casey` via the dispatch namespace

### Dispatch Worker Implementation

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname; // e.g., "casey.studylog.ai"
    
    // Extract tenant subdomain
    const parts = hostname.split('.');
    const subdomain = parts[0];
    
    // Reserved subdomains (don't route to tenants)
    if (['www', 'api', 'app', 'dashboard'].includes(subdomain)) {
      return handlePlatformRoute(request, subdomain);
    }
    
    // Look up tenant in dispatch namespace
    const userWorker = env.DISPATCH_NAMESPACE.get(subdomain);
    if (!userWorker) {
      return new Response('Tenant not found', { status: 404 });
    }
    
    // Forward to user worker
    return userWorker.fetch(request);
  },
};
```

**Key point: One dispatch Worker handles ALL subdomains.** No per-subdomain Pages deployments needed. The UI is served from the User Worker (which includes static assets or fetches from a shared R2 bucket).

### Custom Domain Support

Cloudflare for SaaS (Cloudflare for Platforms) supports **custom hostnames**:

- User adds a CNAME: `ai.theirname.com → studylog.ai`
- Platform calls the Custom Hostname API to register the domain
- Cloudflare provisions an SSL certificate automatically

```bash
curl -X POST "https://api.cloudflare.com/client/v4/zones/{zone_id}/custom_hostnames" \
  -H "Authorization: Bearer {api_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "hostname": "ai.theirname.com",
    "ssl": {
      "type": "dv",
      "method": "txt",
      "wildcard": false
    },
    "custom_metadata": {
      "tenant_id": "casey"
    }
  }'
```

---

## 3. Onboarding Flow

### New User Signup Sequence

```
┌─────────┐     ┌──────────────┐     ┌─────────────┐     ┌────────────┐
│  User    │────▶│  Onboarding  │────▶│  Provision  │────▶│  Ready!    │
│  visits  │     │  Worker      │     │  Worker     │     │  Redirect  │
│ studylog │     │              │     │  (async)    │     │  to their  │
│  .ai     │     │              │     │             │     │  instance  │
└─────────┘     └──────────────┘     └─────────────┘     └────────────┘
```

### Step-by-Step

1. **User visits studylog.ai**, enters desired subdomain "casey"
2. **Onboarding Worker** validates subdomain availability (check dispatch namespace)
3. **Creates resources via API calls** (sequentially or in parallel):
   - D1 database: `tenant-casey-studylog` (~1-2s)
   - KV namespace: `tenant-casey-studylog` (~1s)
   - R2 bucket: `tenant-casey-studylog` (~1s)
4. **Runs schema migrations** on the new D1 database (creates tables)
5. **Deploys User Worker** with bindings to new resources (~2-5s)
6. **Returns success** — redirects user to `casey.studylog.ai`

### Total Provisioning Time: **~5-10 seconds**

This is fast enough to feel "instant" to users, especially with a progress indicator.

### Can This Be Done Entirely from a Worker?

**Partially, with caveats:**

- ✅ A Worker can make the API calls (using `fetch` to Cloudflare API) — this is a subrequest
- ✅ D1, KV, R2 creation are all REST API calls
- ⚠️ Worker-to-Worker dispatch deployment may require the Workers for Platforms API
- **Recommendation**: Use a separate provisioning service (could be a Worker on a cron, or a lightweight external orchestrator) for reliability. A single Worker invocation has a 50 (free) or 10,000 (paid) subrequest limit, and each API call counts as one.

**The provisioning flow within a single Worker invocation (Paid plan):**
1. Validate subdomain (1 subrequest: check dispatch namespace)
2. Create D1 (1 subrequest)
3. Create KV (1 subrequest)
4. Create R2 (1 subrequest)
5. Run migrations via D1 API (1+ subrequests)
6. Deploy User Worker (1 subrequest)
Total: ~6-8 subrequests — well within limits

---

## 4. Per-User Isolation & Encryption

### Architecture: Per-Tenant D1 with Client-Side Encryption

```
┌──────────────────────────────────────────────────┐
│                  User's Browser                   │
│                                                  │
│  Passphrase ──▶ PBKDF2/Argon2 ──▶ DEK (AES-256) │
│  Conversation ──▶ Encrypt with DEK ──▶ Ciphertext│
│                                                  │
└──────────────────────┬───────────────────────────┘
                       │ (only ciphertext sent)
                       ▼
┌──────────────────────────────────────────────────┐
│           Tenant's D1 Database                    │
│  ┌──────────────────────────────────────────┐    │
│  │ id | encrypted_conversation | nonce      │    │
│  │ 1  | a8f3c...               | xyz123     │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  Platform operator sees ONLY ciphertext          │
└──────────────────────────────────────────────────┘
```

### Key Hierarchy

- **KEK (Key Encryption Key)**: Derived from user's passphrase via PBKDF2 or Argon2
- **DEK (Data Encryption Key)**: Random AES-256-GCM key, encrypted with KEK, stored in D1
- **Data**: Encrypted with DEK before being stored

### Why Per-Tenant D1 (not shared)

1. **True isolation**: Even a bug in query logic can't leak another tenant's data
2. **Simpler encryption model**: Each DEK lives in its own DB, no cross-tenant key risk
3. **Independent backups**: D1 Time Travel works per-database
4. **Deletion**: Deleting a tenant means dropping their DB — clean removal

### "Grant Friend Access"

When User A grants User B access to a conversation:

1. User A's browser decrypts the conversation with their DEK
2. Re-encrypts with User B's public key (or a shared DEK derived via a key agreement protocol like X25519)
3. Stores the re-encrypted copy in User B's D1 (or in a shared access table in User A's D1)

```
User A: passphrase_A → KEK_A → DEK_A → decrypt conversation
                         │
                         ▼
              Re-encrypt with shared_key (X25519 between A and B)
                         │
                         ▼
              Store in User B's D1 (or A's "shared" table)
```

The friend gets their own encrypted copy. The original remains accessible only to User A.

---

## 5. Cost Model & Pricing

### Cloudflare Workers Paid Plan Pricing

| Resource | Included (monthly) | Overage |
|----------|-------------------|---------|
| Worker Requests | 10 million | +$0.30/million |
| Worker CPU Time | 30 million ms | +$0.02/million ms |
| D1 Storage | 5 GB total | +$0.75/GB-month |
| D1 Rows Read | 5 billion | +$1.00/million |
| D1 Rows Written | 1 million | +$1.00/million |
| KV Reads | 10 million | +$0.50/million |
| KV Writes | 1 million | +$5.00/million |
| KV Storage | 1 GB | +$0.50/GB-month |
| R2 Storage | 10 GB | +$0.015/GB-month |
| R2 Class A Operations | 1 million | +$4.50/million |
| R2 Class B Operations | 10 million | +$0.36/million |
| **Minimum monthly charge** | **$5.00/month** | |

### Cost at Scale

#### 10 Users
- Requests: 1M/month → **$0** (included in 10M)
- D1: 10 × ~50MB = 500MB → **$0** (included in 5GB)
- KV: minimal → **$0**
- R2: minimal → **$0**
- **Total: $5/month** (Workers Paid minimum)

#### 1,000 Users
- Requests: ~100M/month (avg 100 requests/user/day × 30 days)
  - Included: 10M, Overage: 90M × $0.30 = **$27**
- D1 Storage: ~500GB (500MB avg/user)
  - Included: 5GB, Overage: 495GB × $0.75 = **$371**
- D1 Rows Read: ~10B/month (heavy conversational use)
  - Included: 5B, Overage: 5B × $1.00/million = **$5,000**
- KV: ~5M reads, ~500K writes → **~$2.50**
- R2: ~50GB → **~$0.60**
- **Total: ~$5,406/month** (~$5.41/user/month)

#### 10,000 Users
- Requests: ~1B/month
  - Overage: 990M × $0.30 = **$297**
- D1 Storage: ~5TB → **EXCEEDS 1TB account limit** ⚠️
  - Need multiple accounts or reduce per-tenant storage
  - At 500MB/user avg: 5TB > 1TB limit. Need ~200MB/user avg.
  - At 200MB/user: 2TB > 1TB limit. Still exceeds.
  - **Reality: At 10K users, shared D1 with tenant_id becomes necessary**
- D1 Rows Read: ~100B → **$95,000** (astronomical)
- **Total at 10K users with per-tenant D1: NOT VIABLE**

### ⚠️ Critical Finding: Per-Tenant D1 Doesn't Scale to 10K+ Users

**The 1TB total D1 storage limit and per-row-read pricing make per-tenant D1 economically impossible at scale.**

### Revised Architecture for Scale

| Scale | Isolation Strategy |
|-------|-------------------|
| 1-1,000 users | Per-tenant D1 (true isolation, simple) |
| 1,000-100,000 users | **Hybrid**: Shared D1 with tenant_id partitioning + per-tenant KV/R2 |
| 100,000+ users | Shared D1 with tenant_id + sharding across multiple D1 databases |

### Shared D1 Architecture (1K+ tenants)

```sql
-- All tenant data in shared D1 with tenant_id prefix
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  encrypted_data BLOB NOT NULL,
  nonce TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX idx_conversations_tenant ON conversations(tenant_id);

-- All queries MUST include tenant_id
SELECT * FROM conversations WHERE tenant_id = ? AND id = ?;
```

**Enforcing isolation**: A middleware layer in the Worker always appends `tenant_id` to every query. The User Worker only knows its own `tenant_id`.

### Cost with Shared D1 at 10,000 Users

- D1 Storage: 2TB → **$1,493** (1TB included in 5GB? No — included is 5GB total)
  - Actually: 2TB × $0.75/GB = **$1,500/month**
- D1 Rows Read: Optimized with indexes, ~5B reads → **$0** (included)
- Worker requests: **$297/month**
- KV: ~50M reads → **$20/month**
- R2: ~500GB → **$7/month**
- **Total: ~$1,824/month** (~$0.18/user/month) ✅

---

## 6. Custom Domain Support

### Cloudflare for SaaS (included with Cloudflare for Platforms)

**How it works:**
1. User adds CNAME record: `ai.theirname.com CNAME studylog.ai`
2. Platform calls Custom Hostname API to register
3. Cloudflare auto-provisions SSL certificate (DV via TXT validation)
4. Dispatch Worker handles `ai.theirname.com` same as `casey.studylog.ai`

**API Call:**
```bash
POST /zones/{zone_id}/custom_hostnames
{
  "hostname": "ai.theirname.com",
  "ssl": { "type": "dv", "method": "txt" },
  "custom_metadata": { "tenant_id": "casey" }
}
```

**Dispatch Worker modification:**
```typescript
// First check custom hostname metadata
const tenantId = env.CUSTOM_HOSTNAME_MAPPING[hostname] || 
  hostname.split('.')[0]; // fallback to subdomain parsing
```

**Cost: Included** with Cloudflare for SaaS on Pro+ plans. Free plan supports up to 100 custom hostnames.

---

## 7. Scaling Architecture by Tier

### Tier 1: 10 Users (MVP)

```
┌─────────────────────────────────────┐
│  *.studylog.ai (wildcard DNS)       │
│           │                         │
│     Dispatch Worker                 │
│     (routes by hostname)            │
│           │                         │
│  ┌────┬────┬────┬────┬────┐        │
│  │ t1 │ t2 │ t3 │... │ t10│        │
│  │D1  │D1  │D1  │D1  │D1  │        │
│  │KV  │KV  │KV  │KV  │KV  │        │
│  │R2  │R2  │R2  │R2  │R2  │        │
│  └────┴────┴────┴────┴────┘        │
│                                     │
│  1 account, Workers Paid ($5/mo)    │
│  10 D1 DBs, 10 KV NS, 10 R2 buckets│
│  Total: ~$5/month                   │
└─────────────────────────────────────┘
```

- **Bottleneck**: None. Everything is fast and well within limits.
- **Isolation**: Per-tenant everything. Maximum security.

### Tier 2: 1,000 Users

```
┌──────────────────────────────────────┐
│  *.studylog.ai + custom domains      │
│           │                          │
│     Dispatch Worker                  │
│     (hostname → tenant lookup)       │
│           │                          │
│  ┌─────────────────────────────┐    │
│  │  User Workers (1000)        │    │
│  │  Workers for Platforms      │    │
│  │  ├─ Per-tenant KV (shared)  │    │
│  │  ├─ Per-tenant R2           │    │
│  │  └─ Shared D1 (tenant_id)   │    │
│  └─────────────────────────────┘    │
│                                      │
│  1-2 accounts, Workers Paid          │
│  1 D1 DB (sharded by tenant_id)     │
│  1000 KV namespaces                  │
│  1000 R2 buckets                     │
│  Total: ~$5,400/month                │
└──────────────────────────────────────┘
```

- **Bottleneck**: D1 row-read costs. Indexing strategy critical.
- **Isolation**: Hybrid — shared D1 with tenant_id, per-tenant KV/R2
- **Mitigation**: Batch queries, aggressive caching in KV, use Durable Objects for session state instead of frequent D1 reads

### Tier 3: 100,000 Users

```
┌──────────────────────────────────────┐
│  *.studylog.ai + custom domains      │
│           │                          │
│     Dispatch Worker Cluster          │
│     (load balanced by CF)            │
│           │                          │
│  ┌─────────────────────────────┐    │
│  │  User Workers (100K)        │    │
│  │  Workers for Platforms      │    │
│  │  ├─ Per-tenant R2           │    │
│  │  ├─ Durable Objects         │    │
│  │  │   (session state, rate   │    │
│  │  │    limits per tenant)    │    │
│  │  └─ Shared D1 × N           │    │
│  │      (sharded by tenant     │    │
│  │       hash range)           │    │
│  └─────────────────────────────┘    │
│                                      │
│  Multiple accounts (sharded)         │
│  D1 sharding: 10-50 databases        │
│  DO for state: replaces most KV      │
│  Total: ~$15,000-30,000/month        │
└──────────────────────────────────────┘
```

**What breaks at 100K users:**

| Component | Limit | Mitigation |
|-----------|-------|------------|
| D1 total storage | 1TB/account | Shard across multiple CF accounts (each $5/mo minimum) |
| D1 row-read costs | $1/million | Aggressive caching, batch reads, use DO for hot data |
| Worker count | Unlimited (WfP) | OK — Workers for Platforms handles this |
| KV namespace count | Unlimited (paid) | Consider Durable Objects instead for session state |
| Dispatch Worker | Single point | CF auto-scales Workers globally — not a real bottleneck |
| Provisioning | 100K initial setup | Must be async with queue (Cloudflare Queues) |

### D1 Sharding Strategy (100K+)

```typescript
// Hash tenant_id to determine which D1 shard to use
function getShard(tenantId: string, shardCount: number): number {
  let hash = 0;
  for (let i = 0; i < tenantId.length; i++) {
    hash = ((hash << 5) - hash) + tenantId.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % shardCount;
}

// In User Worker
const shard = getShard(env.TENANT_ID, env.SHARD_COUNT);
const db = env.D1_SHARDS[shard]; // Binding to the correct shard
```

---

## 8. Provisioning API Endpoints

### Onboarding REST API (implemented as a Worker)

```
POST /api/tenants
  Body: { "subdomain": "casey", "email": "casey@example.com", "passphrase_hash": "..." }
  Response: { "tenant_id": "casey", "subdomain": "casey.studylog.ai", "status": "provisioning" }

GET /api/tenants/{tenant_id}/status
  Response: { "status": "ready", "created_at": "2026-03-25T..." }
```

### Provisioning Worker Implementation

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'POST' && new URL(request.url).pathname === '/api/tenants') {
      const { subdomain, email, passphrase_hash } = await request.json();
      
      // 1. Validate subdomain
      if (!/^[a-z0-9][a-z0-9-]{2,28}[a-z0-9]$/.test(subdomain)) {
        return Response.json({ error: 'Invalid subdomain' }, { status: 400 });
      }
      
      // 2. Check availability
      const existing = await env.DISPATCH_NAMESPACE.get(subdomain);
      if (existing) {
        return Response.json({ error: 'Subdomain taken' }, { status: 409 });
      }
      
      // 3. Provision resources (parallel)
      const [d1Result, kvResult, r2Result] = await Promise.all([
        createD1Database(env, subdomain),
        createKVNamespace(env, subdomain),
        createR2Bucket(env, subdomain),
      ]);
      
      // 4. Run migrations
      await runMigrations(env, d1Result.uuid);
      
      // 5. Deploy User Worker with bindings
      await deployUserWorker(env, subdomain, {
        d1_id: d1Result.uuid,
        kv_id: kvResult.id,
        r2_bucket: `tenant-${subdomain}`,
        tenant_id: subdomain,
        passphrase_hash,
      });
      
      // 6. Store tenant metadata
      await env.TENANT_REGISTRY.put(subdomain, JSON.stringify({
        subdomain,
        email,
        d1_uuid: d1Result.uuid,
        kv_id: kvResult.id,
        created_at: new Date().toISOString(),
      }));
      
      return Response.json({ 
        tenant_id: subdomain, 
        subdomain: `${subdomain}.studylog.ai`,
        status: 'ready' 
      }, { status: 201 });
    }
  },
};
```

---

## 9. Complete Architecture Summary

### Recommended Architecture

```
                    ┌─────────────────────────────────┐
                    │     studylog.ai (Cloudflare Zone)│
                    │     *.studylog.ai (wildcard)     │
                    │     + Custom Hostnames           │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │        DISPATCH WORKER          │
                    │  (hostname → tenant_id lookup)  │
                    │  Workers for Platforms          │
                    └──┬──────────────────────────┬──┘
                       │                          │
          ┌────────────▼──────┐       ┌──────────▼─────────┐
          │  Platform Routes  │       │  Tenant Workers    │
          │  (www, api, app)  │       │  (per-tenant)      │
          │                   │       │                    │
          │  ├─ Dashboard     │       │  ├─ D1 (per-tenant │
          │  ├─ Auth Service  │       │  │  or shared)      │
          │  └─ Billing       │       │  ├─ KV (session,   │
          │                   │       │  │  rate limits)    │
          └───────────────────┘       │  ├─ R2 (files)     │
                                      │  └─ DO (state)     │
                                      └────────────────────┘
```

### Key Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Platform | Workers for Platforms | Purpose-built for multi-tenant |
| Routing | Dispatch Worker + hostname parsing | Simple, scalable, handles custom domains |
| D1 Strategy | Per-tenant (<1K), Shared with tenant_id (>1K) | Cost vs isolation tradeoff |
| KV | Per-tenant namespaces | Simple isolation, unlimited on paid |
| R2 | Per-tenant buckets | Clean deletion, true file isolation |
| Encryption | Client-side AES-256-GCM with per-user DEK | Operator can't read data |
| Custom domains | Cloudflare for SaaS (Custom Hostnames) | Included, auto-SSL |
| Provisioning | Worker-based (API calls) | Serverless, instant (~5-10s) |

### Migration Path

1. **MVP (0-100 users)**: Per-tenant D1, per-tenant KV/R2, Workers for Platforms
2. **Growth (100-1K users)**: Same architecture, optimize D1 queries, add caching
3. **Scale (1K-10K users)**: Migrate to shared D1 with tenant_id, keep per-tenant KV/R2
4. **Massive (10K-100K users)**: D1 sharding, Durable Objects for hot state, multi-account

### Estimated Monthly Costs

| Users | Cost/Month | Cost/User/Month |
|-------|-----------|-----------------|
| 10 | $5 | $0.50 |
| 100 | $15 | $0.15 |
| 1,000 | $5,400 | $5.40 |
| 10,000 | $1,824 | $0.18 |
| 100,000 | $15,000-30,000 | $0.15-0.30 |

**Bottom line: Multi-tenant on Cloudflare IS economically viable, but requires architectural evolution from per-tenant D1 to shared/sharded D1 as user count grows.**
