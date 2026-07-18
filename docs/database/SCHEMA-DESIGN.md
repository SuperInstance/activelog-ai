# Schema Design — log-origin

> D1 (SQLite) database schema for the log-origin AI gateway.
> Primary data store for sessions, messages, PII, routing, feedback, and providers.

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [ULID Primary Keys](#2-ulid-primary-keys)
3. [Core Tables](#3-core-tables)
4. [Routing & Intelligence Tables](#4-routing--intelligence-tables)
5. [Provider & Agent Tables](#5-provider--agent-tables)
6. [Archive & Maintenance Tables](#6-archive--maintenance-tables)
7. [Indexes](#7-indexes)
8. [Cursor-Based Pagination](#8-cursor-based-pagination)
9. [Hybrid Storage: Hot/Cold](#9-hybrid-storage-hotcold)
10. [Encryption at Rest](#10-encryption-at-rest)
11. [D1-Specific Constraints](#11-d1-specific-constraints)
12. [Migration Strategy](#12-migration-strategy)
13. [GDPR Deletion Flow](#13-gdpr-deletion-flow)
14. [Full DDL](#14-full-ddl)
15. [Devil's Advocate](#15-devils-advocate)
16. [Open Questions](#16-open-questions)

---

## 1. Design Principles

| Principle | Rationale |
|-----------|-----------|
| **ULID primary keys** | Time-sortable, no auto-increment gaps, globally unique across tables |
| **Denormalize for read speed** | `user_id` on `messages` and `interactions` avoids JOINs to `sessions` |
| **Denormalize aggregates** | `message_count` and `last_message_at` on `sessions` for sidebar display |
| **Application-layer encryption** | AES-256-GCM for PII and API keys; D1 has no native encryption |
| **Additive-only migrations** | Never `DROP TABLE`; new columns are nullable with defaults |
| **Cursor-based pagination** | `created_at + id` composite cursor; no `OFFSET` on large tables |

---

## 2. ULID Primary Keys

All primary keys use ULID (26-char Crockford Base32 string). Generated at the application layer before insertion.

```
01JQQY6RGK   (48-bit timestamp, ms precision — 2025-01-01T00:00:00Z)
  M5SR8PKN   (80-bit randomness)
  R9          (standard: "0" placeholder for future versions)
```

**Properties:**
- Lexicographically sortable by time
- No coordination needed for distributed generation
- Monotonic in single-threaded Workers (no race conditions)
- Extract timestamp with `parseInt(ulid.substring(0, 10), 36) * 1000`

---

## 3. Core Tables

### 3.1 `sessions`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | ULID |
| `user_id` | TEXT | NOT NULL | Denormalized from auth context |
| `title` | TEXT | NOT NULL DEFAULT '' | User-editable or auto-generated from first message |
| `message_count` | INTEGER | NOT NULL DEFAULT 0 | Denormalized; incremented on each message |
| `last_message_at` | TEXT | NOT NULL | ISO 8601; denormalized for sort |
| `created_at` | TEXT | NOT NULL | ISO 8601; set by ULID timestamp |
| `updated_at` | TEXT | NOT NULL | ISO 8601; updated on any change |
| `metadata` | TEXT | DEFAULT '{}' | JSON: tags, pinned status, etc. |

### 3.2 `messages`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | ULID |
| `session_id` | TEXT | NOT NULL, FK → sessions(id) ON DELETE CASCADE | |
| `user_id` | TEXT | NOT NULL | Denormalized; avoids JOIN for auth checks |
| `role` | TEXT | NOT NULL CHECK(role IN ('system','user','assistant')) | |
| `content` | TEXT | NOT NULL | May contain PII tokens like `[EMAIL_1]` |
| `model` | TEXT | | Which model generated this (for assistant messages) |
| `provider_id` | TEXT | | Which provider was used |
| `latency_ms` | INTEGER | | Response latency for assistant messages |
| `tokens` | TEXT | DEFAULT '{}' | JSON: `{prompt: N, completion: N}` |
| `created_at` | TEXT | NOT NULL | ISO 8601 |

### 3.3 `pii_entities`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | ULID |
| `user_id` | TEXT | NOT NULL | |
| `entity_id` | TEXT | NOT NULL | Semantic token: `PERSON_A`, `EMAIL_1` |
| `entity_type` | TEXT | NOT NULL | `person`, `email`, `phone`, `ssn`, `credit_card`, `address`, `date`, `api_key` |
| `real_value` | TEXT | NOT NULL | **Encrypted** with AES-256-GCM (ciphertext) |
| `session_id` | TEXT | | Origin session (nullable for global entities) |
| `use_count` | INTEGER | NOT NULL DEFAULT 0 | Incremented on each hydration |
| `last_used_at` | TEXT | NOT NULL | ISO 8601 |
| `created_at` | TEXT | NOT NULL | ISO 8601 |

**Unique constraint:** `(user_id, entity_id)` — prevents duplicate tokens within a user's scope.

### 3.4 `interactions`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | ULID |
| `session_id` | TEXT | NOT NULL, FK → sessions(id) ON DELETE CASCADE | |
| `user_id` | TEXT | NOT NULL | Denormalized |
| `message_id` | TEXT | FK → messages(id) ON DELETE SET NULL | Links to the user message |
| `classification` | TEXT | NOT NULL | `cheap`, `escalation`, `compare`, `draft`, `local`, `manual` |
| `confidence` | REAL | NOT NULL | 0.0–1.0 from router |
| `provider_id` | TEXT | NOT NULL | Which provider handled this |
| `model` | TEXT | NOT NULL | Which model was used |
| `latency_ms` | INTEGER | | |
| `tokens` | TEXT | DEFAULT '{}' | JSON usage |
| `created_at` | TEXT | NOT NULL | ISO 8601 |

---

## 4. Routing & Intelligence Tables

### 4.1 `feedback`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | ULID |
| `interaction_id` | TEXT | NOT NULL, FK → interactions(id) ON DELETE CASCADE | |
| `user_id` | TEXT | NOT NULL | Denormalized |
| `rating` | TEXT | NOT NULL CHECK(rating IN ('up','down')) | |
| `critique` | TEXT | | Optional user explanation |
| `created_at` | TEXT | NOT NULL | ISO 8601 |

### 4.2 `routing_rules`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | ULID |
| `user_id` | TEXT | NOT NULL | |
| `name` | TEXT | NOT NULL | Human-readable rule name |
| `pattern` | TEXT | NOT NULL | Regex pattern for message matching |
| `action` | TEXT | NOT NULL | Target routing action |
| `confidence` | REAL | NOT NULL | Rule's confidence score |
| `source` | TEXT | NOT NULL DEFAULT 'static' | `static`, `learned` |
| `enabled` | INTEGER | NOT NULL DEFAULT 1 | Learned rules start disabled (0) |
| `hit_count` | INTEGER | NOT NULL DEFAULT 0 | Times this rule matched |
| `confirming_events` | INTEGER | NOT NULL DEFAULT 0 | Positive feedback count for learned rules |
| `auto_enable_threshold` | INTEGER | NOT NULL DEFAULT 10 | Confirming events needed to auto-enable |
| `created_at` | TEXT | NOT NULL | ISO 8601 |
| `updated_at` | TEXT | NOT NULL | ISO 8601 |

---

## 5. Provider & Agent Tables

### 5.1 `user_preferences`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | ULID |
| `user_id` | TEXT | NOT NULL | |
| `key` | TEXT | NOT NULL | Preference key |
| `value` | TEXT | NOT NULL | Preference value (JSON if complex) |
| `updated_at` | TEXT | NOT NULL | ISO 8601 |

**Unique constraint:** `(user_id, key)`

### 5.2 `providers`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | ULID |
| `user_id` | TEXT | NOT NULL | |
| `type` | TEXT | NOT NULL | `openai-compatible`, `workers-ai`, `local` |
| `name` | TEXT | NOT NULL | Display name |
| `base_url` | TEXT | | API endpoint |
| `api_key` | TEXT | | **Encrypted** with AES-256-GCM |
| `model` | TEXT | NOT NULL | Model identifier |
| `roles` | TEXT | NOT NULL DEFAULT '["cheap"]' | JSON array of roles |
| `max_tokens` | INTEGER | DEFAULT 4096 | |
| `temperature` | REAL | DEFAULT 0.7 | |
| `priority` | INTEGER | NOT NULL DEFAULT 0 | Higher = preferred |
| `enabled` | INTEGER | NOT NULL DEFAULT 1 | |
| `health_status` | TEXT | NOT NULL DEFAULT 'healthy' | `healthy`, `degraded`, `offline` |
| `consecutive_failures` | INTEGER | NOT NULL DEFAULT 0 | |
| `degraded_until` | TEXT | | ISO 8601; when degradation expires |
| `created_at` | TEXT | NOT NULL | ISO 8601 |
| `updated_at` | TEXT | NOT NULL | ISO 8601 |

### 5.3 `agent_registry`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | ULID |
| `user_id` | TEXT | NOT NULL | |
| `did` | TEXT | NOT NULL | Decentralized identity: `did:log:{user}:{domain}:{agent}` |
| `name` | TEXT | NOT NULL | |
| `address` | TEXT | | HTTPS endpoint |
| `ws_endpoint` | TEXT | | WebSocket endpoint |
| `capabilities` | TEXT | NOT NULL DEFAULT '[]' | JSON array of capability IDs |
| `status` | TEXT | NOT NULL DEFAULT 'offline' | `online`, `offline`, `degraded`, `maintenance` |
| `last_heartbeat` | TEXT | | ISO 8601 |
| `priority` | INTEGER | NOT NULL DEFAULT 0 | Higher = preferred for failover |
| `is_local` | INTEGER | NOT NULL DEFAULT 0 | Boolean: runs on user hardware |
| `created_at` | TEXT | NOT NULL | ISO 8601 |
| `updated_at` | TEXT | NOT NULL | ISO 8601 |

### 5.4 `agent_health`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | ULID |
| `agent_id` | TEXT | NOT NULL, FK → agent_registry(id) ON DELETE CASCADE | |
| `user_id` | TEXT | NOT NULL | |
| `status` | TEXT | NOT NULL | `online`, `offline`, `degraded` |
| `load` | REAL | | 0.0–1.0 CPU/memory pressure |
| `queue_depth` | INTEGER | DEFAULT 0 | Pending tasks |
| `uptime_seconds` | INTEGER | | |
| `models_loaded` | TEXT | DEFAULT '[]' | JSON array |
| `checked_at` | TEXT | NOT NULL | ISO 8601 |

---

## 6. Archive & Maintenance Tables

### 6.1 `training_exports`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `id` | TEXT | PRIMARY KEY | ULID |
| `user_id` | TEXT | NOT NULL | |
| `format` | TEXT | NOT NULL | `jsonl`, `jsonl_dpo` |
| `record_count` | INTEGER | NOT NULL | |
| `r2_key` | TEXT | NOT NULL | R2 object key for the export |
| `filters` | TEXT | DEFAULT '{}' | JSON: what was included/excluded |
| `created_at` | TEXT | NOT NULL | ISO 8601 |

### 6.2 `schema_version`

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| `version` | INTEGER | PRIMARY KEY | Current schema version |
| `applied_at` | TEXT | NOT NULL | ISO 8601 |
| `description` | TEXT | NOT NULL | Human-readable migration description |

**Seeded with:** `INSERT INTO schema_version VALUES (1, datetime('now'), 'Initial schema');`

---

## 7. Indexes

```sql
-- Sessions: user listing and sort
CREATE INDEX idx_sessions_user ON sessions(user_id, last_message_at DESC);

-- Messages: session history (time-ordered)
CREATE INDEX idx_messages_session ON messages(session_id, created_at ASC);

-- Messages: user-scoped queries (no JOIN needed)
CREATE INDEX idx_messages_user ON messages(user_id, created_at DESC);

-- PII entities: lookup by token and type
CREATE INDEX idx_pii_entity ON pii_entities(user_id, entity_id);
CREATE INDEX idx_pii_type ON pii_entities(user_id, entity_type);

-- Interactions: analytics queries
CREATE INDEX idx_interactions_session ON interactions(session_id, created_at DESC);
CREATE INDEX idx_interactions_user ON interactions(user_id, created_at DESC);
CREATE INDEX idx_interactions_classification ON interactions(user_id, classification);

-- Feedback: count positive/negative per interaction
CREATE INDEX idx_feedback_interaction ON feedback(interaction_id);

-- Routing rules: source-based queries
CREATE INDEX idx_routing_source ON routing_rules(user_id, source);
CREATE INDEX idx_routing_enabled ON routing_rules(user_id, enabled);

-- Providers: user's provider list
CREATE INDEX idx_providers_user ON providers(user_id);

-- Agent registry: discovery queries
CREATE INDEX idx_agents_user ON agent_registry(user_id, status);
CREATE INDEX idx_agents_did ON agent_registry(did);

-- Agent health: latest check per agent
CREATE INDEX idx_health_agent ON agent_health(agent_id, checked_at DESC);

-- Training exports: user's export history
CREATE INDEX idx_exports_user ON training_exports(user_id, created_at DESC);
```

---

## 8. Cursor-Based Pagination

Uses a composite cursor of `created_at` and `id`. The `id` (ULID) provides sub-millisecond ordering to break ties.

### Cursor format

```
cursor = base64url("created_at|id")
// e.g., base64url("2026-03-25T20:00:00Z|01JQQY6RGKM5SR8PKNR9")
```

### Query pattern

```sql
-- First page (no cursor)
SELECT * FROM messages
WHERE session_id = ? AND user_id = ?
ORDER BY created_at ASC, id ASC
LIMIT 51;  -- +1 to detect next page

-- Subsequent pages
SELECT * FROM messages
WHERE session_id = ? AND user_id = ?
  AND (created_at > ? OR (created_at = ? AND id > ?))
ORDER BY created_at ASC, id ASC
LIMIT 51;
```

### Response envelope

```json
{
  "data": [...],
  "pagination": {
    "next_cursor": "base64url-encoded",
    "has_more": true
  }
}
```

---

## 9. Hybrid Storage: Hot/Cold

### Hot data (D1): Last 90 days

All 12 tables live in D1 for the most recent 90 days of data. This covers active sessions, recent feedback, current routing rules, and provider configs.

### Cold data (R2): Older than 90 days

A scheduled Worker (cron trigger) archives older data to R2:

```
R2 bucket layout:
log-origin-archive/{user_id}/
├── sessions/
│   ├── 2025-01.ndjson.gz
│   └── 2025-02.ndjson.gz
├── messages/
│   ├── 2025-01.ndjson.gz
│   └── 2025-02.ndjson.gz
└── interactions/
    ├── 2025-01.ndjson.gz
    └── 2025-02.ndjson.gz
```

**Archive format:** NDJSON, gzip-compressed. Each line is a complete record. Encryption applied before upload (same AES-256-GCM key).

**Archive criteria:**
- `sessions`: `last_message_at` older than 90 days
- `messages`: `created_at` older than 90 days
- `interactions`: `created_at` older than 90 days
- `pii_entities`: never archived (always hot; used across sessions)
- `routing_rules`: never archived (always active)
- `providers`: never archived (config)

### Retrieval from cold storage

When a user views an old session, the Worker checks D1 first, then falls back to R2. Cold data is fetched, decrypted, and streamed to the client without re-inserting into D1.

---

## 10. Encryption at Rest

### Encrypted columns

| Table | Column | Content |
|-------|--------|---------|
| `pii_entities` | `real_value` | PII plaintext (email, phone, SSN, name, etc.) |
| `providers` | `api_key` | Provider API key (OpenAI, DeepSeek, etc.) |

### Encryption scheme

```
Input plaintext
    │
    ▼
AES-256-GCM encrypt(
  plaintext,
  DEK,                    // Derived from user passphrase (PBKDF2)
  randomIV(12 bytes),     // Stored alongside ciphertext
)
    │
    ▼
{iv || ciphertext || authTag}  → stored as base64 string in column
```

The DEK is request-scoped in Worker memory (~3ms). It is never persisted. See `docs/privacy/PRIVACY-ARCHITECTURE.md` for the full key exchange flow.

---

## 11. D1-Specific Constraints

Based on Cloudflare D1 limitations (from `.research/cloudflare-arch.md`):

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| No `ATTACH DATABASE` | Can't split data across files | Single DB; use R2 for overflow |
| No loadable extensions | No `fts5`, `json1` enhancements | Application-layer JSON handling; KV for full-text if needed |
| No WAL on edge | Standard journal mode | Acceptable for write-light workloads |
| Connection pooling internal | Can't control pool size | Use prepared statements, batch operations |
| Query latency on cold reads | 100ms+ on first query per region | KV cache for hot queries; read replicas for global |
| DDL counts toward reads/writes | Migrations cost quota | Run migrations during setup, not in request path |

---

## 12. Migration Strategy

### Additive-only

Every migration file is a new numbered SQL file that only adds tables, columns, or indexes.

```
db/migrations/
├── 0001_initial.sql          -- All 12 tables + indexes
├── 0002_add_session_tags.sql -- ALTER TABLE sessions ADD COLUMN tags TEXT
├── 0003_add_provider_roles.sql -- (example)
└── meta/
    └── _journal.json         -- Drizzle migration journal
```

**Rules:**
1. Never `DROP TABLE`, `DROP COLUMN`, or `ALTER COLUMN` with type changes
2. New columns are nullable or have default values
3. Indexes are created with `IF NOT EXISTS`
4. Each migration updates `schema_version` table

### Application-level schema checks

On Worker startup, query `schema_version` to verify compatibility:

```typescript
const result = await env.DB.prepare('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1').first();
if (result.version < REQUIRED_VERSION) {
  throw new Error(`Schema version ${result.version} is below required ${REQUIRED_VERSION}. Run migrations.`);
}
```

---

## 13. GDPR Deletion Flow

User requests account deletion → cascade through all related data:

```
DELETE FROM pii_entities WHERE user_id = ?
  → PII tokens removed

DELETE FROM feedback WHERE user_id = ?
  → Feedback removed

DELETE FROM interactions WHERE user_id = ?
  → Interaction logs removed

DELETE FROM messages WHERE user_id = ?
  → Messages removed

DELETE FROM sessions WHERE user_id = ?
  → Sessions removed (CASCADE already handled messages/interactions)

DELETE FROM routing_rules WHERE user_id = ?
  → Learned rules removed

DELETE FROM providers WHERE user_id = ?
  → Provider configs (including encrypted API keys) removed

DELETE FROM user_preferences WHERE user_id = ?
  → Preferences removed

DELETE FROM agent_registry WHERE user_id = ?
  → Agent registrations removed

DELETE FROM agent_health WHERE user_id = ?
  → Health history removed

DELETE FROM training_exports WHERE user_id = ?
  → Export metadata removed
  → (R2 objects need separate deletion)

-- R2 cleanup: list and delete all objects under {user_id}/
```

### Implementation

```typescript
async function deleteUser(env: Bindings, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pii_entities WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM feedback WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM interactions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM messages WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM routing_rules WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM providers WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_preferences WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM agent_registry WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM agent_health WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM training_exports WHERE user_id = ?').bind(userId),
  ]);

  // Clean R2
  const listed = await env.R2.list({ prefix: `log-origin-archive/${userId}/` });
  await Promise.all(listed.objects.map(obj => env.R2.delete(obj.key)));

  // Clean KV session tokens
  const keys = await env.KV.list({ prefix: `session:${userId}:` });
  await Promise.all(keys.keys.map(k => env.KV.delete(k.name)));
}
```

---

## 14. Full DDL

```sql
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL,
  description TEXT NOT NULL
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, last_message_at DESC);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
  content TEXT NOT NULL,
  model TEXT,
  provider_id TEXT,
  latency_ms INTEGER,
  tokens TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at DESC);

-- PII entities
CREATE TABLE IF NOT EXISTS pii_entities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  real_value TEXT NOT NULL,
  session_id TEXT,
  use_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(user_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_pii_entity ON pii_entities(user_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_pii_type ON pii_entities(user_id, entity_type);

-- Interactions
CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  classification TEXT NOT NULL,
  confidence REAL NOT NULL,
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  latency_ms INTEGER,
  tokens TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interactions_session ON interactions(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_user ON interactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_classification ON interactions(user_id, classification);

-- Feedback
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  interaction_id TEXT NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK(rating IN ('up','down')),
  critique TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_interaction ON feedback(interaction_id);

-- Routing rules
CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  action TEXT NOT NULL,
  confidence REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'static',
  enabled INTEGER NOT NULL DEFAULT 1,
  hit_count INTEGER NOT NULL DEFAULT 0,
  confirming_events INTEGER NOT NULL DEFAULT 0,
  auto_enable_threshold INTEGER NOT NULL DEFAULT 10,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_routing_source ON routing_rules(user_id, source);
CREATE INDEX IF NOT EXISTS idx_routing_enabled ON routing_rules(user_id, enabled);

-- User preferences
CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, key)
);

-- Providers
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT,
  api_key TEXT,
  model TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '["cheap"]',
  max_tokens INTEGER DEFAULT 4096,
  temperature REAL DEFAULT 0.7,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  health_status TEXT NOT NULL DEFAULT 'healthy',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  degraded_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id);

-- Agent registry
CREATE TABLE IF NOT EXISTS agent_registry (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  did TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  ws_endpoint TEXT,
  capabilities TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'offline',
  last_heartbeat TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  is_local INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_user ON agent_registry(user_id, status);
CREATE INDEX IF NOT EXISTS idx_agents_did ON agent_registry(did);

-- Agent health
CREATE TABLE IF NOT EXISTS agent_health (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agent_registry(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  load REAL,
  queue_depth INTEGER DEFAULT 0,
  uptime_seconds INTEGER,
  models_loaded TEXT DEFAULT '[]',
  checked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_health_agent ON agent_health(agent_id, checked_at DESC);

-- Training exports
CREATE TABLE IF NOT EXISTS training_exports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  format TEXT NOT NULL,
  record_count INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  filters TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exports_user ON training_exports(user_id, created_at DESC);

-- Seed schema version
INSERT OR IGNORE INTO schema_version (version, applied_at, description)
VALUES (1, datetime('now'), 'Initial schema: 12 tables');
```

---

## 15. Devil's Advocate

### "ULIDs are overkill for a single-user SQLite database."

**Counterargument:** True — auto-increment integers would work fine for a personal deployment. ULIDs add complexity (app-layer generation, Base32 encoding) for no tangible benefit at single-user scale.

**Rebuttal:** ULIDs are forward-looking. The platform vision includes multi-tenant Workers for Platforms deployment where distributed ID generation matters. Using ULIDs now avoids a migration later. The implementation cost is negligible (a few lines of TypeScript). Also, ULIDs embed timestamps, which simplifies debugging — you can glance at an ID and know when it was created.

### "Denormalizing user_id creates update anomalies."

**Counterargument:** If a user's `user_id` changes, you must update it across 8 tables. This is error-prone.

**Rebuttal:** `user_id` never changes. It's derived from the passphrase hash and is immutable for the lifetime of the deployment. This isn't a traditional multi-tenant system where users can migrate between accounts. Denormalization here trades a non-existent update risk for read performance on every query.

### "SQLite (D1) is wrong for this. Use PostgreSQL."

**Counterargument:** D1's 5GB limit, no extensions, no WAL, and eventual read consistency are serious limitations. PostgreSQL on a VPS gives you FTS5, JSONB, proper WAL, and unlimited storage.

**Rebuttal:** D1 is the right choice *for the target user*. The fork-and-deploy model requires zero infrastructure management. D1 is free, globally distributed, and deeply integrated with Workers. The 5GB limit covers years of personal chat history. For users who need PostgreSQL, they can swap Drizzle adapters — the schema is portable. But for 95% of users, D1 is the right default.

### "Hybrid hot/cold storage is premature complexity."

**Counterargument:** Start with everything in D1. Add archival when someone actually hits 5GB. YAGNI.

**Rebuttal:** Fair — implement hot-only for Phase 1. The schema already supports cold storage (tables are designed for exportability). The cold pipeline is a Phase 3 concern. However, designing for it now (ULID timestamps, NDJSON-friendly columns) means we don't need a schema migration later.

---

## 16. Open Questions

1. **R2 encryption key management:** Should archived data use the same DEK as live data, or a separate archive key? Same DEK means losing the passphrase loses archives too. Separate key adds key management complexity.

2. **PII entity deduplication across sessions:** If a user mentions "John Smith" in session A and session B, should they share the same `[PERSON_A]` token? Current design says yes (unique constraint on `(user_id, entity_id)`). But this means stale entity mappings persist indefinitely.

3. **Migration rollbacks:** We don't support `DROP TABLE`. If migration 0003 has a bug, how do we fix it? We can only add new migrations that correct the data. Should we include a `schema_version.downgrade_supported` flag?

4. **Multi-user isolation in D1:** The platform vision mentions Workers for Platforms with per-tenant D1. But Phase 1 is single-user. Do we need a `tenant_id` column now, or add it in Phase 6?

5. **Index maintenance cost:** 14 indexes on a D1 database means every INSERT updates multiple B-trees. At scale (100K+ messages), this may impact write performance. Should we defer non-critical indexes?

6. **Schema version conflict resolution:** If a user skips migrations (e.g., goes from v1 to v5), the gap migrations run sequentially. Is this safe? Should we add dependency checking?
