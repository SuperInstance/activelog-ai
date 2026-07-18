# Forkable Repo Design & UX Research

> LOG-mcp: A forkable repository that's both a deployable application AND a personalization platform.

---

## 1. Forkable App Patterns

### What Makes a Repo "Forkable" vs "Cloneable"

A **forkable** repo is designed so the fork *is the deployment*. A **cloneable** repo is just source code you build elsewhere.

Key differences:

| Forkable | Cloneable |
|----------|-----------|
| Fork → Deploy pipeline auto-wired | Manual build/deploy steps |
| User config lives IN the repo | Config lives in env/separate infra |
| `main` branch = production | Separate CI/CD pipeline |
| README is the onboarding flow | README is documentation |
| `wrangler.toml` / `vercel.json` committed | Generated per-deployment |

### How the Big Players Do It

**Vercel Templates** (`vercel new <template>`):
- Uses `vercel.json` + `.env.example` pattern
- Zero-config deploy from fork — Vercel detects framework automatically
- Environment variables configured in Vercel dashboard post-deploy
- `usefulWidget` in README triggers one-click deploy buttons

**Supabase Starters**:
- Fork → connect to your Supabase project (URL + anon key as env vars)
- `supabase/config.toml` in repo defines schema migrations
- Migrations run on `supabase db push` — schema lives in repo, data does not
- `.env.local.example` shows required vars, `.env.local` is gitignored

**Cursor Rules**:
- `.cursorrules` file in repo root
- Fork includes the rules file → your fork has your custom instructions
- Upstream updates pulled via normal git workflow

### Forkable vs Cloneable: The Forkable Checklist

```
✅ One-command deploy from fork (Cloudflare Pages/Workers auto-deploy)
✅ All config in committed files (not env vars)
✅ Secrets configured through platform dashboard (never in repo)
✅ README has onboarding steps, not just docs
✅ .env.example documents required secrets
✅ Default/empty state works without any user data
✅ wrangler.toml / deployment config committed and functional
```

---

## 2. Secrets-Out-of-Repo Pattern

### The Architecture

```
┌─────────────────────────────────────────────────┐
│  GitHub Repo (NO SECRETS EVER)                   │
│  ├── .env.example          ← template only       │
│  ├── .env                  ← .gitignored         │
│  ├── wrangler.toml         ← no API keys         │
│  └── src/                                        │
└────────────────────┬────────────────────────────┘
                     │ deploy
                     ▼
┌─────────────────────────────────────────────────┐
│  Cloudflare Platform                             │
│  ├── Workers Secrets       ← API keys           │
│  │   ├── OPENAI_API_KEY                          │
│  │   ├── DEEPSEEK_API_KEY                        │
│  │   └── GROQ_API_KEY                            │
│  ├── KV Namespace          ← user config store   │
│  │   └── settings:{key}    ← runtime config      │
│  └── D1 Database           ← structured data      │
│      └── routing_rules, preferences, etc.        │
└─────────────────────────────────────────────────┘
```

### Web UI Secret Management Flow

```
User visits /setup
    → App checks: are secrets configured?
    → No? → Show setup wizard
        → User pastes OpenAI key
        → Worker calls: 
          await env.KV.put('secret:openai', encryptedKey)
          OR
          wrangler secret put OPENAI_API_KEY (via API)
    → Yes? → Show configured providers, allow add/remove/edit
```

### Two Approaches for Secret Storage

**Option A: Cloudflare Workers Secrets (Recommended for API keys)**
```typescript
// Admin endpoint, called from /setup UI
// Uses Cloudflare API token (not user's keys)
app.post('/api/setup/provider', async (req) => {
  const { provider, apiKey } = req.body;
  
  // Store in KV with encryption layer
  // The Worker's own identity handles auth to AI providers
  await env.KV.put(`provider:${provider}:key`, encrypt(apiKey, env.ENCRYPTION_KEY));
  
  // Or use Cloudflare Secrets API for true env-level injection
  // This requires a separate API token with Workers Scripts:Edit
});
```

**Option B: Cloudflare Secrets API (True env-level)**
```typescript
// POST to Cloudflare API to set Worker secret
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${scriptName}/secrets`,
  {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'OPENAI_API_KEY',
      text: apiKey,
      type: 'secret_text'
    })
  }
);
```

### Recommended Hybrid Approach

```
┌──────────────────────────┐
│  .env.example (in repo)  │  ← Documents what's needed
│  FEATURE_FLAGS           │  ← Non-secret config IN repo
│  DEFAULT_MODEL           │
│  MAX_TOKENS              │
│  THEME                   │
│  SYSTEM_PROMPT_TEMPLATE  │
└──────────────────────────┘

┌──────────────────────────┐
│  Cloudflare Secrets       │  ← Sensitive API keys
│  OPENAI_API_KEY           │     Never in repo, never in KV
│  DEEPSEEK_API_KEY         │     Set via /setup UI → CF API
│  GROQ_API_KEY             │
│  ENCRYPTION_KEY           │  ← Auto-generated on deploy
└──────────────────────────┘

┌──────────────────────────┐
│  D1 Database              │  ← User's runtime data
│  provider_configs         │     Which providers, model prefs
│  routing_rules            │     Learned routing logic
│  conversations            │     Chat history (optional)
│  themes                   │     Custom theme overrides
└──────────────────────────┘
```

---

## 3. Promotable Forks / Use-Case Templates

### The Problem

User A builds a medical AI gateway. Wants to share the "personality" (routing rules, system prompts, theme) without sharing patient data.

### The Solution: Layered Config Architecture

```
log-mcp/
├── app/                          ← CODE (always from upstream)
│   ├── src/
│   ├── wrangler.toml
│   └── package.json
├── config/
│   ├── personality.md            ← System prompts, tone, persona
│   ├── routing-rules.yaml        ← How to route queries
│   ├── providers.yaml            ← Which LLM providers to use
│   ├── theme.json                ← UI customization
│   └── features.yaml             ← Feature flags & defaults
├── data/                         ← .gitignored, personal
│   └── (conversations, learned prefs, usage stats)
└── secrets/                      ← .gitignored, never committed
    └── .env
```

### Separation Strategy

| Layer | What | Where | Sharable? |
|-------|------|-------|-----------|
| **Code** | App logic, UI framework | `app/` | ✅ Always |
| **Personality** | System prompts, routing rules, model prefs | `config/` | ✅ Yes, this IS the template |
| **Data** | Conversations, learned patterns, usage | `data/` (D1/KV) | ❌ Personal |
| **Secrets** | API keys, tokens | Cloudflare Secrets | ❌ Never |

### Template Promotion Workflow

```
User A: "I want to share my medical AI gateway"

1. User A reviews config/personality.md → no personal info ✅
2. User A reviews config/routing-rules.yaml → no patient data ✅
3. User A creates a new repo: "log-mcp-medical"
4. Copy app/ (code) + config/ (personality) into new repo
5. Add README explaining the medical use case
6. User B forks → gets the personality, adds their own keys + data
```

### Git Branches vs Tags vs Submodules

**Don't use submodules** — they add complexity that defeats the forkable purpose.

**Use branches for development, tags for releases:**
```
main          ← stable, user forks from here
next          ← bleeding edge
v0.1.0        ← release tag
v0.2.0        ← release tag
```

**For template distribution, use a separate repo:**
- Each "template" is a complete fork with custom `config/`
- Upstream repo has `config/default/` with sensible defaults
- Template repos override `config/` with their specialized version

---

## 4. UX Customization Without Code Changes

### Theme System (CSS Variables)

```css
/* config/theme.json → injected as CSS custom properties */
:root {
  --color-primary: #6366f1;
  --color-surface: #1e1e2e;
  --color-text: #cdd6f4;
  --font-family: 'Inter', sans-serif;
  --border-radius: 12px;
  --chat-bubble-style: rounded; /* rounded | square | minimal */
  --sidebar-position: left;     /* left | right | hidden */
  --layout: chat;               /* chat | dashboard | minimal */
}
```

```json
// config/theme.json
{
  "name": "Midnight",
  "colors": {
    "primary": "#6366f1",
    "surface": "#1e1e2e",
    "text": "#cdd6f4"
  },
  "layout": "chat",
  "sidebar": "left",
  "chatBubbleStyle": "rounded",
  "logo": "/assets/logo.svg",
  "favicon": "/assets/favicon.svg",
  "customCSS": ""  // Advanced users can add raw CSS
}
```

### Config-Driven UI (YAML)

```yaml
# config/features.yaml
ui:
  showTokenCount: true
  showModelSelector: true
  showProviderStatus: true
  defaultView: chat          # chat | history | settings
  maxHistoryVisible: 50
  enableFileUpload: true
  enableVoiceInput: false
  welcomeMessage: |
    Hello! I'm your AI gateway. I route your queries to the best model.
    Type /help to see what I can do.

personality:
  name: "LOG"
  tagline: "Your AI Router"
  systemPromptFile: config/personality.md
  tone: professional          # professional | casual | technical | friendly
  responseStyle: concise      # concise | detailed | balanced
```

### Personality Without Code

```markdown
<!-- config/personality.md -->
# Personality: Medical Research Assistant

You are a specialized AI gateway for medical research queries.

## Behavior
- Always cite sources when providing medical information
- Flag unverified claims with ⚠️
- Prioritize evidence-based responses
- Use medical terminology accurately
- When unsure, recommend consulting a healthcare professional

## Routing Rules
- Drug interactions → PubMed search + specialist model
- General symptoms → General practitioner model
- Research papers → Academic analysis model
- Emergency keywords → Direct to human, no AI response

## Tone
Professional but approachable. Think: "knowledgeable colleague" not "textbook."
```

### Non-Developer Customization Path

```
1. Fork repo on GitHub
2. Edit config/theme.json to change colors/layout
3. Edit config/personality.md to change AI behavior
4. Edit config/features.yaml to toggle features
5. Push → auto-deploy
```

**For truly non-technical users**, build a Settings UI:

```
/settings
├── Appearance     → Theme editor (color picker, layout selector)
├── Personality    → System prompt editor (WYSIWYG-ish)
├── Providers      → Connect API keys
├── Routing        → Visual rule builder (drag & drop)
└── Advanced       → Raw config file editor
```

Changes made in Settings UI → saved to D1/KV → app reads config from DB, falling back to repo files.

---

## 5. Update Mechanism

### The Core Problem

```
User's fork (v0.1 with customizations)
    + Upstream v0.2 (bug fixes)
    = ??? (merge conflicts, lost changes, broken configs)
```

### Strategy: Config-Code Separation + Protected Files

```
log-mcp/
├── app/              ← USER SHOULD NOT TOUCH THIS
│   └── src/          ← All upstream changes go here
├── config/           ← USER OWNS THIS (but can accept upstream defaults)
│   ├── personality.md
│   ├── routing-rules.yaml
│   └── theme.json
├── .github/
│   └── upstream-merge.yml   ← Automates upstream sync
└── README.md
```

### Update Workflow Options

**Option A: GitHub Actions Upstream Sync (Recommended)**

```yaml
# .github/workflows/sync-upstream.yml
name: Sync Upstream
on:
  schedule:
    - cron: '0 6 * * 1'  # Weekly Monday check
  workflow_dispatch:       # Manual trigger

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 0
      - name: Configure git
        run: |
          git remote add upstream https://github.com/original/log-mcp.git
          git fetch upstream
      - name: Merge upstream/main into main
        run: |
          git merge upstream/main --no-edit --allow-unrelated-histories \
            --strategy=recursive \
            -X ours -- app/          # Prefer user changes in app/
          # OR
          -X theirs -- app/          # Prefer upstream changes in app/ (RECOMMENDED)
          # Keep user config/ untouched
        continue-on-error: true
      - name: Push if merged
        run: git push origin main
```

**Better: Use gitattributes to define merge strategy per-path**

```
# .gitattributes
app/ merge=theirs    # Always take upstream code changes
config/ merge=ours   # Always keep user's config
README.md merge=theirs
```

**Option B: Plugin/Extension Pattern (For advanced divergence)**

If users want to heavily customize without merge pain:

```
app/
├── core/                ← Untouched upstream code
├── plugins/
│   ├── my-custom-router.js    ← User's extension
│   └── my-custom-theme.css
└── plugin-loader.js      ← Loads plugins from plugins/ directory
```

**Option C: Release Tags + Manual Merge**

Most flexible but requires user initiative:
```
# User runs these commands
git remote add upstream https://github.com/original/log-mcp.git
git fetch upstream --tags
git merge v0.2.0        # Merge specific tag
# Resolve conflicts (if any, should be rare with good separation)
git push
```

### Recommended: Hybrid Approach

```
1. Use .gitattributes to auto-resolve code vs config conflicts
2. GitHub Action for automated weekly sync (code only)
3. Release tags for manual update if user wants control
4. Plugin directory for extensions that don't touch core
5. Config/ directory is sacred — upstream never overwrites it
```

### Migration Script Pattern

For breaking changes between versions:

```typescript
// app/src/migrations.ts
const migrations = {
  '0.1.0→0.2.0': async (env: Env) => {
    // Move routing rules from KV to D1
    const rules = await env.KV.get('routing_rules');
    if (rules) {
      await env.DB.prepare('INSERT INTO routing_rules (config) VALUES (?)').bind(rules).run();
      await env.KV.delete('routing_rules');
    }
  },
  '0.2.0→0.3.0': async (env: Env) => {
    // Add new default theme values
    // ...
  }
};

export async function runMigrations(env: Env, fromVersion: string, toVersion: string) {
  const key = `${fromVersion}→${toVersion}`;
  if (migrations[key]) {
    await migrations[key](env);
  }
}
```

---

## 6. The "Trained and Turned" Distribution Model

### Concept

User A builds → trains → customizes → shares → User B benefits without User A's data.

### The Architecture: Three-Layer Separation

```
Layer 1: CODE (app/)
├── Always from upstream
├── Pure logic, no user data
└── Shared identically across all deployments

Layer 2: PERSONALITY (config/)
├── System prompts, routing rules, theme, feature flags
├── This IS the "trained" knowledge worth sharing
├── Stored in repo AND in D1 (for runtime access)
└── Exportable/importable as a "personality pack"

Layer 3: DATA (D1/KV, never in repo)
├── Conversations, learned patterns, usage stats
├── User-specific, privacy-sensitive
└── Never exported or shared
```

### "Personality Pack" Format

```json
{
  "name": "Medical Research Gateway",
  "author": "User A",
  "version": "1.0.0",
  "description": "Optimized for medical Q&A with PubMed integration",
  "config": {
    "personality.md": "# Medical Research Assistant\n...",
    "routing-rules.yaml": "...",
    "theme.json": "...",
    "features.yaml": "..."
  },
  "requirements": {
    "providers": ["openai", "pubmed"],
    "features": ["fileUpload", "citations"]
  },
  "dataExcluded": true
}
```

### Distribution Flow

```
User A clicks "Export Template"
    → App reads config/ from D1
    → Generates personality-pack.json
    → Downloads or publishes to GitHub repo

User B clicks "Import Template"  
    → Uploads personality-pack.json OR enters GitHub repo URL
    → App validates requirements (providers, features)
    → Writes config to D1
    → User B adds their own API keys via /setup
    → Ready to go with User A's personality, User B's keys + data
```

### GitHub-Based Distribution

```
# User A's template repo: log-mcp-medical
log-mcp-medical/
├── README.md                    # "Medical AI Gateway - fork me!"
├── config/
│   ├── personality.md           # Medical-specific prompts
│   ├── routing-rules.yaml       # Medical routing logic
│   └── theme.json               # Clean, professional theme
├── app/                         # Vendored or submodule'd from upstream
│   └── ...
└── .github/
    └── FUNDING.yml              # Optional: accept donations
```

User B:
1. Forks log-mcp-medical
2. Connects to Cloudflare (deploy button in README)
3. Visits /setup → adds API keys
4. Has a working medical AI gateway in 5 minutes

### Registry Idea (Future)

```
log-mcp-registry.com/
├── Browse templates: Medical, Legal, Education, Creative
├── Install: One-click fork + deploy
├── Rate & Review
└── Version history
```

---

## Recommended Repo Structure

```
log-mcp/
│
├── .github/
│   ├── workflows/
│   │   ├── deploy.yml              # Auto-deploy on push to main
│   │   └── sync-upstream.yml       # Weekly upstream sync
│   └── FUNDING.yml
│
├── app/                            # === CODE LAYER ===
│   ├── src/
│   │   ├── index.ts                # Worker entry point
│   │   ├── router.ts               # Query routing engine
│   │   ├── providers/              # LLM provider adapters
│   │   │   ├── openai.ts
│   │   │   ├── deepseek.ts
│   │   │   └── groq.ts
│   │   ├── ui/                     # Frontend (Hono + HTMX or similar)
│   │   ├── api/                    # API endpoints
│   │   ├── config-loader.ts        # Reads config from repo + DB
│   │   └── migrations/             # Schema/data migrations
│   ├── public/
│   │   └── assets/
│   ├── wrangler.toml               # Cloudflare config (no secrets)
│   ├── package.json
│   └── tsconfig.json
│
├── config/                         # === PERSONALITY LAYER ===
│   ├── default/                    # Upstream defaults (don't edit)
│   │   ├── personality.md
│   │   ├── routing-rules.yaml
│   │   ├── theme.json
│   │   └── features.yaml
│   └── custom/                     # User overrides (gitignored by upstream)
│       ├── personality.md          # User's custom personality
│       ├── routing-rules.yaml
│       ├── theme.json
│       └── features.yaml
│
├── plugins/                        # === EXTENSION LAYER (optional) ===
│   └── .gitkeep
│
├── .env.example                    # Documents required secrets
├── .env                            # gitignored
├── .gitattributes                  # Merge strategy: code=theirs, config=ours
├── .gitignore
├── README.md                       # Onboarding flow + deploy button
├── LICENSE
└── CHANGELOG.md
```

### .gitattributes (Critical for clean merges)

```
app/ merge=theirs
config/default/ merge=theirs
config/custom/ merge=ours
plugins/ merge=ours
README.md merge=theirs
CHANGELOG.md merge=theirs
```

### Config Loader Priority

```typescript
// app/src/config-loader.ts
// Priority: config/custom/ (user) > D1 database (runtime UI changes) > config/default/ (upstream)

export async function loadConfig(env: Env): Promise<FullConfig> {
  const defaults = await loadFromRepo('config/default/');
  const custom = await loadFromRepo('config/custom/');
  const runtime = await loadFromDB(env.DB);
  
  return deepMerge(defaults, deepMerge(custom, runtime));
}
```

---

## Workflow Diagrams

### Fork & Deploy Flow

```
┌──────────┐     Fork      ┌──────────┐     Auto-deploy    ┌──────────┐
│  Upstream │ ──────────► │  User's   │ ───────────────► │ Cloudflare│
│  Repo     │              │  Fork     │                   │ Workers  │
│  (template│              │  (app/)   │                   │          │
│   + config│              │  (config/)│                   │          │
│  /default)│              │           │                   │          │
└──────────┘              └─────┬─────┘                   └──────────┘
                                │                              │
                         Setup UI                          Runtime
                                │                              │
                                ▼                              ▼
                         ┌──────────┐                   ┌──────────┐
                         │ /setup   │ ──API keys──►    │ Cloudflare│
                         │ page     │                   │ Secrets  │
                         └──────────┘                   └──────────┘
```

### Template Distribution Flow

```
┌──────────┐              ┌──────────────┐              ┌──────────┐
│  User A  │  Export      │  Personality  │  Fork        │  User B  │
│  builds  │ ──────────► │  Pack (.json) │ ──────────► │  deploys │
│  trains  │              │  or GitHub   │              │  adds    │
│  tunes   │              │  repo        │              │  keys    │
└──────────┘              └──────────────┘              └──────────┘

  PERSONALITY included:           PERSONALITY included:
  ✅ System prompts                ✅ System prompts
  ✅ Routing rules                 ✅ Routing rules
  ✅ Theme                         ✅ Theme
  ✅ Feature flags                 ✅ Feature flags

  DATA excluded:                   DATA fresh:
  ❌ Conversations                 ✅ Clean slate
  ❌ User preferences              ✅ Their own keys
  ❌ API keys                      ✅ Their own history
```

### Update Flow

```
┌──────────┐  release v0.2   ┌──────────┐  fetch upstream   ┌──────────┐
│  Upstream │ ──────────────► │  User's  │ ────────────────► │  Git     │
│  v0.2     │                  │  fork    │                    │  merge   │
│  (app/    │                  │  v0.1 +  │                    │          │
│   only)   │                  │  custom) │                    │          │
└──────────┘                  └──────────┘                   └────┬─────┘
                                                                    │
                          ┌─────────────────────────────────────────┘
                          │
                          ▼
              .gitattributes resolves:
              app/         → take upstream (theirs)
              config/custom/ → keep user's (ours)
              config/default/ → take upstream (theirs)
                          │
                          ▼
                   ┌──────────┐
                   │ Auto-    │
                   │ deploy   │
                   │ succeeds │
                   └──────────┘
```

---

## Key Decisions Summary

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Secrets storage | Cloudflare Workers Secrets API | Never in repo, accessible via /setup UI |
| Config format | YAML + Markdown | Human-readable, git-friendly, supports comments |
| Theme system | CSS variables driven by `theme.json` | No code changes for visual customization |
| Personality | Markdown file + routing YAML | Editable by non-developers |
| Update strategy | `.gitattributes` + GitHub Action | Automatic, conflict-free code updates |
| Template format | Config bundle (JSON) or GitHub repo | Easy to create, fork, and share |
| DB for runtime | D1 (structured data) + KV (session/cache) | Cloudflare native, no external deps |
| Migration system | Versioned migration scripts in `app/src/migrations/` | Handles breaking schema changes |

---

## Open Questions

1. **Should `config/custom/` be committed to the user's fork?** 
   - Yes — this IS their customization. But the upstream repo should `.gitignore` it so upstream PRs don't accidentally include user configs.
   
2. **Should we support a "no-fork" SaaS mode?**
   - Future consideration. Multi-tenant D1 with per-user config. The forkable model is the MVP.

3. **How do we handle provider-specific routing that evolves?**
   - Routing rules in `config/` are the user's domain. Provider adapters in `app/` are upstream's domain. They evolve independently.

4. **Should the web UI settings write to D1 or to the repo?**
   - D1 for runtime (immediate effect), with an "Export to config/" button for persistence across redeployments. This keeps settings UI changes safe while allowing power users to commit their config.
