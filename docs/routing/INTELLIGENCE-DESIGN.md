# Routing Intelligence Design — log-origin

> How log-origin decides where to send each message: static rules, learned patterns,
> command prefixes, provider health, and draft comparison.

## Table of Contents

1. [Overview](#1-overview)
2. [Routing Actions](#2-routing-actions)
3. [Classification Pipeline](#3-classification-pipeline)
4. [Static Rules](#4-static-rules)
5. [Command Prefixes](#5-command-prefixes)
6. [Learned Rules](#6-learned-rules)
7. [Provider Health & Failover](#7-provider-health--failover)
8. [Draft Mode: Multi-Provider Comparison](#8-draft-mode-multi-provider-comparison)
9. [Feedback Loop](#9-feedback-loop)
10. [Cold Start Strategy](#10-cold-start-strategy)
11. [Full Routing Rules SQL Schema](#11-full-routing-rules-sql-schema)
12. [Devil's Advocate](#12-devils-advocate)
13. [Open Questions](#13-open-questions)

---

## 1. Overview

The router's job: given a user message, decide which provider/model should handle it. The decision is driven by three inputs:

```
User message
    │
    ▼
┌─────────────────────────────────┐
│      CLASSIFICATION PIPELINE     │
│                                  │
│  1. Command prefix check         │  → /draft, /local, /compare, /manual
│  2. Static regex rules           │  → 14 patterns (ported from Python)
│  3. Learned rules (if enabled)   │  → feedback-derived patterns
│  4. Default fallback             │  → "cheap" action
│                                  │
│  Output: Classification {        │
│    action, confidence, reason    │
│  }                               │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│      PROVIDER RESOLUTION         │
│                                  │
│  action → provider mapping       │
│  health check (skip degraded)    │
│  priority ordering               │
│                                  │
│  Output: Provider + Model ID     │
└─────────────┬───────────────────┘
              │
              ▼
┌─────────────────────────────────┐
│      EXECUTION                   │
│                                  │
│  cheap: send to cheap provider   │
│  escalation: send to quality     │
│  compare: fan-out to N, present  │
│  draft: parallel, store ranking  │
│  local: route via tunnel         │
│  manual: ask user to choose      │
└─────────────────────────────────┘
```

---

## 2. Routing Actions

| Action | Description | When Used |
|--------|-------------|-----------|
| **cheap** | Route to cheapest/fastest model | Default for simple queries, small talk, factual Q&A |
| **escalation** | Route to highest-quality model | Complex reasoning, code generation, creative writing |
| **compare** | Fan-out to multiple providers, show side-by-side | User explicitly requests comparison via `/compare` |
| **draft** | Run parallel round, store rankings for learning | User explicitly requests via `/draft`, or system-triggered for ambiguity |
| **local** | Route to local instance via tunnel | Privacy-sensitive tasks, local file access, `/local` prefix |
| **manual** | Ask the user to pick a provider | High-stakes decisions, `/manual` prefix, or very low confidence |

---

## 3. Classification Pipeline

Implemented as a layered regex approach, compatible with Cloudflare Workers (no ML model needed at the edge).

### Step 1: Command prefix check

```typescript
function checkCommandPrefix(message: string): Classification | null {
  const trimmed = message.trim();
  
  if (trimmed.startsWith('/draft ')) {
    return { action: 'draft', confidence: 1.0, reason: 'Command prefix: /draft' };
  }
  if (trimmed.startsWith('/local ')) {
    return { action: 'local', confidence: 1.0, reason: 'Command prefix: /local' };
  }
  if (trimmed.startsWith('/compare ')) {
    return { action: 'compare', confidence: 1.0, reason: 'Command prefix: /compare' };
  }
  if (trimmed.startsWith('/manual ')) {
    return { action: 'manual', confidence: 1.0, reason: 'Command prefix: /manual' };
  }
  
  return null;
}
```

Command prefixes always win. They are stripped from the message before forwarding to the provider.

### Step 2: Static rules (14 patterns)

Evaluated in order. First match wins. See [Section 4](#4-static-rules) for the full list.

```typescript
function checkStaticRules(message: string): Classification | null {
  for (const rule of STATIC_RULES) {
    if (rule.pattern.test(message)) {
      return {
        action: rule.action,
        confidence: rule.confidence,
        reason: `Static rule: ${rule.name}`,
      };
    }
  }
  return null;
}
```

### Step 3: Learned rules (if enabled)

```typescript
async function checkLearnedRules(message: string, env: Bindings): Promise<Classification | null> {
  const rules = await env.DB.prepare(
    'SELECT * FROM routing_rules WHERE user_id = ? AND source = ? AND enabled = 1 ORDER BY confidence DESC'
  ).bind(userId, 'learned').all();
  
  for (const rule of rules.results) {
    if (new RegExp(rule.pattern).test(message)) {
      return {
        action: rule.action,
        confidence: rule.confidence,
        reason: `Learned rule: ${rule.name}`,
      };
    }
  }
  return null;
}
```

### Step 4: Default fallback

```typescript
function defaultClassification(): Classification {
  return { action: 'cheap', confidence: 0.3, reason: 'Default fallback' };
}
```

### Pipeline assembly

```typescript
async function classify(message: string, userId: string, env: Bindings): Promise<Classification> {
  return (
    checkCommandPrefix(message) ??
    checkStaticRules(message) ??
    await checkLearnedRules(message, env) ??
    defaultClassification()
  );
}
```

---

## 4. Static Rules

Ported from the Python `_STATIC_RULES` in `vault/routing_script.py`. Each rule has a name, regex pattern, target action, and confidence.

### Rule List

| # | Name | Pattern (simplified) | Action | Confidence | Rationale |
|---|------|---------------------|--------|------------|-----------|
| 1 | Code Generation | `\b(write|create|implement|build|code|program|script)\b.*\b(function|class|module|component|api|endpoint|handler)\b` | escalation | 0.85 | Code tasks need quality |
| 2 | Debug Request | `\b(debug|fix|error|bug|issue|broken|crash|traceback|exception)\b` | escalation | 0.85 | Debug needs reasoning |
| 3 | Code Review | `\b(review|refactor|optimize|improve|clean up)\b.*\b(code|function|class|module)\b` | escalation | 0.80 | Review benefits from quality |
| 4 | Mathematical Reasoning | `\b(calculate|compute|solve|prove|derive|equation|formula|integral)\b` | escalation | 0.90 | Math needs precision |
| 5 | Complex Analysis | `\b(analyze|compare|evaluate|assess|critique|synthesize)\b` | escalation | 0.70 | Analysis benefits from quality |
| 6 | Creative Writing | `\b(write|compose|draft|create)\b.*\b(story|poem|essay|article|blog|song|script)\b` | escalation | 0.75 | Creative needs quality |
| 7 | Translation | `\b(translate|convert)\b.*\b(to|into|from)\b.*\b(spanish|french|german|chinese|japanese|korean|russian|arabic)\b` | cheap | 0.80 | Translation is well-handled by smaller models |
| 8 | Summarization | `\b(summarize|summarise|tldr|brief|recap|outline|condense)\b` | cheap | 0.80 | Summarization is cheap-model capable |
| 9 | Simple Q&A | `\b(what is|what are|who is|where is|when is|how do|how does|define|explain)\b` | cheap | 0.60 | Factual queries don't need expensive models |
| 10 | Factual Lookup | `^(what|who|where|when|how many|how much)\?` | cheap | 0.70 | Direct factual questions |
| 11 | Chat/Social | `\b(hello|hi|hey|thanks|thank you|bye|good morning|good night|how are you)\b` | cheap | 0.90 | Social chit-chat doesn't need quality |
| 12 | List/Enumeration | `\b(list|enumerate|give me|name)\b.*\b(\d+|few|some|all|top)\b` | cheap | 0.70 | Lists are easy |
| 13 | Instruction Following | `\b(set up|configure|install|deploy|how to)\b` | escalation | 0.75 | Instructions need accuracy |
| 14 | Privacy-Sensitive | `\b(password|ssn|social security|credit card|bank account|medical|diagnosis|prescription)\b` | local | 0.85 | Privacy-sensitive should stay local |

### TypeScript implementation

```typescript
interface StaticRule {
  name: string;
  pattern: RegExp;
  action: RoutingAction;
  confidence: number;
}

const STATIC_RULES: StaticRule[] = [
  {
    name: 'code_generation',
    pattern: /\b(write|create|implement|build|code|program|script)\b.*\b(function|class|module|component|api|endpoint|handler)\b/i,
    action: 'escalation',
    confidence: 0.85,
  },
  // ... 13 more rules
];
```

---

## 5. Command Prefixes

| Prefix | Action | Strips prefix? | Example |
|--------|--------|---------------|---------|
| `/draft` | draft | Yes | `/draft write a blog post about AI` → runs parallel round |
| `/local` | local | Yes | `/local analyze my photo` → routes to local instance only |
| `/compare` | compare | Yes | `/compare explain quantum computing` → shows side-by-side |
| `/manual` | manual | Yes | `/manual should I use React or Vue?` → user picks provider |

The prefix is stripped before PII detection and routing. The resulting classification has confidence 1.0 (user override).

---

## 6. Learned Rules

Learned rules are created from aggregate feedback data. They start **disabled** and require positive confirmation before activation.

### Creation trigger

When 5 or more feedback events (positive ratings) suggest a pattern, a candidate learned rule is created:

```typescript
async function checkForLearnedRules(userId: string, env: Bindings): Promise<void> {
  // Find patterns in highly-rated interactions
  const patterns = await env.DB.prepare(`
    SELECT
      i.classification,
      i.provider_id,
      COUNT(f.id) as positive_count,
      GROUP_CONCAT(DISTINCT SUBSTR(i.message_id, 1, 8)) as sample_ids
    FROM interactions i
    JOIN feedback f ON f.interaction_id = i.id AND f.rating = 'up'
    WHERE i.user_id = ?
      AND i.created_at > datetime('now', '-30 days')
    GROUP BY i.classification, i.provider_id
    HAVING positive_count >= 5
  `).bind(userId).all();

  for (const pattern of patterns.results) {
    // Check if a rule already exists for this pattern
    const existing = await env.DB.prepare(
      'SELECT id FROM routing_rules WHERE user_id = ? AND action = ? AND source = ?'
    ).bind(userId, pattern.classification, 'learned').first();

    if (!existing) {
      // Create candidate rule (disabled)
      await env.DB.prepare(`
        INSERT INTO routing_rules (id, user_id, name, pattern, action, confidence, source, enabled, confirming_events, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'learned', 0, ?, datetime('now'), datetime('now'))
      `).bind(
        generateUlid(),
        userId,
        `learned_${pattern.classification}_${pattern.provider_id}`,
        '', // pattern TBD — need to derive from sample messages
        pattern.classification,
        0.5,
        pattern.positive_count,
      ).run();
    }
  }
}
```

### Auto-enable threshold

Learned rules auto-enable after **10 confirming events** (positive feedback on interactions that matched the rule's pattern):

```typescript
async function checkAutoEnable(ruleId: string, env: Bindings): Promise<boolean> {
  const rule = await env.DB.prepare('SELECT * FROM routing_rules WHERE id = ?').bind(ruleId).first();
  if (!rule || rule.enabled) return false;

  if (rule.confirming_events >= rule.auto_enable_threshold) {
    await env.DB.prepare(
      'UPDATE routing_rules SET enabled = 1, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(ruleId).run();
    return true;
  }
  return false;
}
```

### Confidence threshold for compare mode

When confidence is below 0.5 on a non-command classification, the system may suggest compare mode (but does not force it):

```typescript
function shouldSuggestCompare(classification: Classification): boolean {
  // Only suggest if confidence is uncertain AND user hasn't explicitly chosen
  return classification.confidence < 0.5 && classification.confidence > 0.2;
}
```

---

## 7. Provider Health & Failover

### Health tracking

Each provider has health status tracked in the `providers` table:

```
State transitions:
  healthy ──[3 consecutive failures]──→ degraded
  degraded ──[5min timer expires]──→ healthy (retry)
  degraded ──[3 more failures]──→ degraded (longer backoff)
  healthy ──[success]──→ healthy (reset failure counter)
  degraded ──[10 consecutive failures]──→ offline
  offline ──[manual re-enable or 24h timer]──→ degraded (retry)
```

### Exponential backoff

| Consecutive Failures | Degradation Duration |
|---------------------|---------------------|
| 3 | 5 minutes |
| 6 | 15 minutes |
| 9 | 30 minutes |
| 12 | 1 hour |
| 15 | 2 hours |
| 18 | 4 hours |
| 21 | 8 hours |
| 24+ | 24 hours (max) |

```typescript
function calculateDegradationDuration(consecutiveFailures: number): number {
  const baseMinutes = 5;
  const maxMinutes = 24 * 60;
  const minutes = baseMinutes * Math.pow(2, Math.floor(consecutiveFailures / 3) - 1);
  return Math.min(minutes, maxMinutes) * 60 * 1000; // ms
}
```

### Resolution with health checks

```typescript
async function resolveProvider(action: RoutingAction, userId: string, env: Bindings): Promise<Provider> {
  const now = new Date().toISOString();
  
  const providers = await env.DB.prepare(`
    SELECT * FROM providers
    WHERE user_id = ?
      AND enabled = 1
      AND (health_status != 'degraded' OR degraded_until IS NULL OR degraded_until < ?)
      AND json_extract(roles, '$') LIKE ?
    ORDER BY priority DESC
  `).bind(userId, now, `%${action}%`).all();
  
  if (providers.results.length === 0) {
    // Fallback: any enabled provider
    const fallback = await env.DB.prepare(`
      SELECT * FROM providers WHERE user_id = ? AND enabled = 1 ORDER BY priority DESC LIMIT 1
    `).bind(userId).first();
    
    if (!fallback) throw new ProviderUnavailableError('No providers configured');
    return fallback;
  }
  
  return providers.results[0];
}
```

### Failure recording

```typescript
async function recordProviderFailure(providerId: string, env: Bindings): Promise<void> {
  const provider = await env.DB.prepare('SELECT * FROM providers WHERE id = ?').bind(providerId).first();
  if (!provider) return;
  
  const failures = provider.consecutive_failures + 1;
  const duration = calculateDegradationDuration(failures);
  const degradedUntil = failures >= 3 
    ? new Date(Date.now() + duration).toISOString() 
    : null;
  const status = failures >= 24 ? 'offline' : (failures >= 3 ? 'degraded' : 'healthy');
  
  await env.DB.prepare(`
    UPDATE providers SET
      consecutive_failures = ?,
      health_status = ?,
      degraded_until = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(failures, status, degradedUntil, providerId).run();
}

async function recordProviderSuccess(providerId: string, env: Bindings): Promise<void> {
  await env.DB.prepare(`
    UPDATE providers SET
      consecutive_failures = 0,
      health_status = 'healthy',
      degraded_until = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `).bind(providerId).run();
}
```

---

## 8. Draft Mode: Multi-Provider Comparison

### Execution flow

```
User sends message with /draft prefix (or draft action from router)
    │
    ▼
Fetch all enabled providers (up to 5)
    │
    ▼
┌──────────────────────────────────┐
│  PARALLEL EXECUTION              │
│                                   │
│  Provider A ──→ Response A       │
│  Provider B ──→ Response B       │
│  Provider C ──→ Response C       │
│  (all via Promise.allSettled)     │
└─────────────┬────────────────────┘
              │
              ▼
┌──────────────────────────────────┐
│  STORE & PRESENT                  │
│                                   │
│  1. Log each as interaction       │
│  2. Store draft_round in D1       │
│  3. Present cards to user         │
│  4. User picks winner → feedback  │
└──────────────────────────────────┘
```

### TypeScript implementation

```typescript
interface DraftResult {
  providerId: string;
  modelName: string;
  content: string;
  latencyMs: number;
  tokens: { prompt: number; completion: number };
  error?: string;
}

async function executeDraftRound(
  messages: ProviderMessage[],
  userId: string,
  env: Bindings,
): Promise<DraftResult[]> {
  const providers = await getEnabledProviders(userId, env, { limit: 5 });
  
  const results = await Promise.allSettled(
    providers.map(async (provider) => {
      const start = Date.now();
      try {
        const response = await callProvider(provider, messages, env);
        return {
          providerId: provider.id,
          modelName: provider.model,
          content: response.content,
          latencyMs: Date.now() - start,
          tokens: response.usage,
        };
      } catch (err) {
        return {
          providerId: provider.id,
          modelName: provider.model,
          content: '',
          latencyMs: Date.now() - start,
          tokens: { prompt: 0, completion: 0 },
          error: err.message,
        };
      }
    })
  );
  
  return results
    .filter((r): r is PromiseFulfilledValue<DraftResult> => r.status === 'fulfilled')
    .map(r => r.value);
}
```

### Rankings → routing rules pipeline

When a user consistently picks the same provider for a pattern, a learned routing rule is created:

```
User picks Provider B for "code generation" tasks 5 times
    │
    ▼
System creates learned rule:
  pattern: /\b(write|create|implement|build|code)\b/
  action: escalation
  confidence: 0.85
  source: learned
  enabled: false (needs 10 confirming events)
    │
    ▼
10 more confirmations → auto-enable
    │
    ▼
Future "code generation" messages auto-route without /draft
```

---

## 9. Feedback Loop

### Feedback events

| Event | Source | Effect |
|-------|--------|--------|
| Thumbs up on interaction | User | Increment `confirming_events` on matched learned rule |
| Thumbs down on interaction | User | Decrement confidence on matched learned rule |
| Draft winner selection | User | Store ranking; check if pattern warrants learned rule |
| Draft loser selection | User (implicit) | Store ranking; may lower confidence |
| Explicit provider preference | Settings | Set provider priority directly |

### Threshold for rule changes

**5 feedback events** (positive ratings on the same classification+provider pair) trigger the creation of a candidate learned rule. This threshold prevents overfitting to single anomalous interactions.

```typescript
const FEEDBACK_THRESHOLD_FOR_RULE_CREATION = 5;
const CONFIRMING_EVENTS_FOR_AUTO_ENABLE = 10;
```

---

## 10. Cold Start Strategy

When a new user deploys log-origin, there is zero feedback history. The system starts with:

1. **Static rules only** — all 14 rules are active from deployment
2. **No learned rules** — the `routing_rules` table has zero `source='learned'` rows
3. **Default fallback: cheap** — unmatched messages go to the cheapest provider
4. **Workers AI as free fallback** — if no provider API keys are configured, Workers AI handles everything

### Progressive intelligence

```
Day 1:   Static rules + default fallback (no learning)
Day 7:   First draft comparisons, initial feedback collected
Day 14:  Candidate learned rules created (5+ feedback events)
Day 30:  First learned rules auto-enabled (10+ confirming events)
Day 60:  Routing accuracy noticeably improved from baseline
Day 90:  User sees measurable cost savings from better routing
```

---

## 11. Full Routing Rules SQL Schema

```sql
CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT PRIMARY KEY,                             -- ULID
  user_id TEXT NOT NULL,                           -- Owning user
  name TEXT NOT NULL,                              -- Human-readable: "learned_code_escalation"
  pattern TEXT NOT NULL,                           -- Regex pattern for matching
  action TEXT NOT NULL,                            -- cheap | escalation | compare | draft | local | manual
  confidence REAL NOT NULL,                        -- 0.0–1.0
  source TEXT NOT NULL DEFAULT 'static',           -- static | learned
  enabled INTEGER NOT NULL DEFAULT 1,              -- 1=active, 0=disabled
  hit_count INTEGER NOT NULL DEFAULT 0,            -- Times this rule matched
  confirming_events INTEGER NOT NULL DEFAULT 0,    -- Positive feedback count (learned rules)
  auto_enable_threshold INTEGER NOT NULL DEFAULT 10, -- Confirming events needed to auto-enable
  created_at TEXT NOT NULL,                        -- ISO 8601
  updated_at TEXT NOT NULL,                        -- ISO 8601
  FOREIGN KEY (user_id) REFERENCES sessions(user_id)  -- logical FK, not enforced
);

CREATE INDEX IF NOT EXISTS idx_routing_source ON routing_rules(user_id, source);
CREATE INDEX IF NOT EXISTS idx_routing_enabled ON routing_rules(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_routing_action ON routing_rules(user_id, action);
```

### Seed data (static rules)

```sql
INSERT INTO routing_rules (id, user_id, name, pattern, action, confidence, source, enabled, created_at, updated_at) VALUES
  ('sr001', '_system', 'code_generation', '(?i)\b(write|create|implement|build|code|program|script)\b.*\b(function|class|module|component|api|endpoint|handler)\b', 'escalation', 0.85, 'static', 1, datetime('now'), datetime('now')),
  ('sr002', '_system', 'debug_request', '(?i)\b(debug|fix|error|bug|issue|broken|crash|traceback|exception)\b', 'escalation', 0.85, 'static', 1, datetime('now'), datetime('now')),
  -- ... 12 more rules
;
```

> Note: Static rules use `user_id = '_system'` as a sentinel value. Per-user rules override system rules by having higher confidence or being matched first in the pipeline.

---

## 12. Devil's Advocate

### "Regex-based routing is too brittle. Use an LLM for classification."

**Counterargument:** A small LLM call for every message adds 50-200ms latency and costs money. Regex is free, instant, and deterministic. The static rules cover 80%+ of common patterns.

**Rebuttal:** The system uses regex as the *default* and LLM classification as an *upgrade path*. If a user enables dynamic routing and has a cheap classification model (Workers AI llama-3.1-8b, ~$0.045/1M tokens), we can add a Step 2.5 that calls the LLM for ambiguous messages (confidence 0.3-0.5). But regex-first is the right default for a free-tier product.

### "14 static rules aren't enough for real-world usage."

**Counterargument:** Users will hit edge cases constantly. "I need to write a Python script to parse JSON" — is this code generation (escalation) or instruction following (also escalation)? Ambiguity leads to wrong routing.

**Rebuttal:** That's intentional. Ambiguity routes to escalation (the higher-quality model), which is the safe default. Wrong routing to cheap is worse than wrong routing to escalation. The rules are designed to be conservative: when in doubt, escalate. Also, users can override with command prefixes at any time.

### "The feedback threshold (5 events for rule creation) is arbitrary."

**Counterargument:** Too low (2-3 events) and noise creates bad rules. Too high (20+ events) and learning takes months. 5 is a guess.

**Rebuttal:** Fair — 5 is a starting point. The threshold should be configurable in user preferences. Advanced users who generate 50+ interactions/day might want a higher threshold to prevent overfitting. Casual users who chat once a day might want a lower threshold to see benefits sooner. Make it a `preference` in `user_preferences`.

---

## 13. Open Questions

1. **LLM-assisted classification:** Should we add an optional step that uses a small local model (Workers AI) for messages that fall through static rules with very low confidence? What's the latency budget?

2. **Pattern derivation for learned rules:** How do we generate the `pattern` regex for learned rules? Currently it's TBD in the code. Options: (a) cluster similar messages by embedding similarity, (b) extract common n-grams, (c) let the user define patterns manually.

3. **Cross-user rule sharing:** In the platform vision, users share "personality packs" that include routing rules. How do we handle conflicting rules when two packs are merged?

4. **Draft round cost management:** A draft round with 5 providers costs 5x a single call. Should we cap draft rounds per day? Charge differently for draft mode?

5. **Routing rule versioning:** When a learned rule is updated (confidence adjusted, pattern refined), should we keep the old version for rollback? How far back?

6. **Privacy-sensitive routing:** Rule 14 routes privacy-sensitive queries to local. But what if the user has no local instance? Should it fall back to a cloud provider with a warning, or refuse to process?
