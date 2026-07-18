# ActiveLog.Ai — Architecture Brief

> Phone-as-transcription-device. Location-annotated voice logs for vessel operations.
> Edge-first. Offline-capable. Cloudflare-backed.

## The 30-Second Pitch

A fisherman opens ActiveLog.Ai on their phone. They press START. The phone transcribes everything they say. Every 60 seconds, the system injects a timestamp + GPS location. When done, they have a markdown session file — locally stored, optionally synced to Cloudflare D1, optionally vectorized for semantic search alongside sounder and camera data.

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    PHONE (Browser)                    │
│                                                       │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ Web Speech│  │ Geolocation│  │ Markdown Session │  │
│  │ API       │  │ API        │  │ (localStorage    │  │
│  │ (free,    │  │ (GPS,      │  │  + IndexedDB     │  │
│  │  built-in)│  │  manual)   │  │  + File download)│  │
│  └─────┬─────┘  └─────┬─────┘  └────────┬─────────┘  │
│        │              │                  │            │
│        └──────────────┴──────────────────┘            │
│                       │                               │
│              ┌────────▼────────┐                      │
│              │  Sync Queue     │                      │
│              │  (offline-first)│                      │
│              └────────┬────────┘                      │
└───────────────────────┼──────────────────────────────┘
                        │ (when online)
                        ▼
┌─────────────────────────────────────────────────────┐
│              CLOUDFLARE EDGE                          │
│                                                       │
│  ┌─────────────┐  ┌─────────┐  ┌────────────────┐   │
│  │ Pages       │  │ Worker  │  │ D1 Database    │   │
│  │ (static app)│  │ (API)   │  │ (sessions,     │   │
│  │             │  │         │  │  annotations)  │   │
│  └─────────────┘  └────┬────┘  └────────────────┘   │
│                        │                             │
│              ┌─────────▼─────────┐                   │
│              │ Vectorize Index   │                   │
│              │ (semantic search) │                   │
│              └───────────────────┘                   │
│                        │                             │
│              ┌─────────▼─────────┐                   │
│              │ R2 Bucket         │                   │
│              │ (raw audio,       │                   │
│              │  session exports) │                   │
│              └───────────────────┘                   │
└─────────────────────────────────────────────────────┘
```

## Authentication Strategy

### Tier 1: Cloudflare Access ( Casey's instance)
- Deploy ActiveLog Worker on Casey's Cloudflare account
- Cloudflare Access policy restricts to authorized users
- D1 + Vectorize + R2 all on Casey's account
- Simple, secure, single-tenant

### Tier 2: Bring Your Own Cloudflare
- User authorizes via Cloudflare API token (OAuth flow or manual token entry)
- ActiveLog Worker makes API calls to user's D1/Vectorize using their token
- Requires user to create D1 database + Vectorize index on their account
- Setup wizard guides them through it

### Tier 3: Local-Only (no Cloudflare)
- App works fully offline, stores markdown in IndexedDB + downloadable files
- No cloud sync, no semantic search
- User can upgrade to Tier 1 or 2 anytime

### Default approach for launch: Tier 1
Deploy on Casey's Cloudflare. Anyone with the URL can use it locally. Cloudflare Access gates the D1 sync. Other users get local-only mode with a prompt to set up their own instance.

## Transcription Pipeline

### Primary: Web Speech API (browser-native, free, offline-capable)
- `SpeechRecognition` API — available in Chrome/Edge/Safari
- Real-time transcription with interim results
- No server needed — runs entirely on device
- Quality is "good enough" for vessel narration (not legal-grade)
- Works offline on mobile browsers (with cached models)

### Fallback: Whisper (for post-processing)
- Raw audio recorded via `MediaRecorder` API simultaneously
- When back online, optionally send audio to a Whisper Worker for higher-quality retranscription
- User can compare browser transcription vs Whisper transcription
- Uses Cloudflare Workers AI Whisper or DeepInfra whisper endpoint

### Annotation Injection
Every 60 seconds (configurable), inject:
```
---
**📍 56.8023°N, 135.4567°W | 🕐 14:32:18 UTC | Speed: 8.2 kn**
---
```

## Session File Format

```markdown
# ActiveLog Session — 2026-07-18

**Started:** 2026-07-18T14:00:00Z
**Ended:** 2026-07-18T15:47:00Z
**Duration:** 1h 47m
**Location Range:** 56.79°N–56.82°N, 135.40°W–135.50°W
**Vessel:** F/V [vessel name]

---

**📍 56.8023°N, 135.4567°W | 🕐 14:00:00 UTC**

Okay we're setting the first string on the eastern edge of the flat.
Wind's out of the southwest maybe fifteen knots. Tide's flooding.

**📍 56.8031°N, 135.4559°W | 🕐 14:01:00 UTC**

Mark, set one is in the water. Eighteen fathoms. We'll soak for about
forty minutes. The sounder is showing some marks up off the bottom here,
could be sablefish...

**📍 56.8034°N, 135.4562°W | 🕐 14:02:00 UTC**

[tag:catch] [tag:species] That's a good mark right there. See the school
suspended about ten fathoms off the bottom? That's the classic sablefish
signature. Dense, tight, not touching the bottom. [important]

---

*Session ended at 15:47 UTC. 107 annotations. 12 voice tags. 3 flagged important.*
```

## Voice Commands

Hands-free tagging while transcribing:

| Command | Action | Markdown Insert |
|---------|--------|-----------------|
| "mark catch" | Tags next segment as catch | `[tag:catch]` |
| "mark maintenance" | Tags maintenance | `[tag:maintenance]` |
| "mark weather" | Tags weather | `[tag:weather]` |
| "flag this" | Flags as important | `[important]` |
| "mark depth [N] fathoms" | Records depth | `[depth:Nfm]` |
| "mark species [name]" | Records species | `[species:name]` |
| "note position" | Immediate GPS injection | Full annotation line |
| "end session" | Stops recording | Session footer |

## D1 Schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  location_start TEXT,
  location_end TEXT,
  annotation_count INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  tags TEXT, -- JSON array
  raw_markdown TEXT NOT NULL,
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  speed REAL,
  heading REAL,
  depth REAL,
  water_temp REAL,
  text_before TEXT, -- transcript segment before this annotation
  text_after TEXT,  -- transcript segment after
  tags TEXT,        -- JSON array
  important BOOLEAN DEFAULT 0,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_session_ts ON annotations(session_id, timestamp);
CREATE INDEX idx_annotations_loc ON annotations(latitude, longitude);
CREATE INDEX idx_annotations_tags ON annotations(tags);
```

## Vectorize Integration

Each annotation (minute-long segment) gets embedded as a vector:
- Text: transcript segment (before/after annotation)
- Metadata: timestamp, GPS, tags, session ID, depth, water_temp
- Embedding model: `@cf/baai/bge-small-en-v1.5` (384 dims, free)

This enables semantic search across ALL sessions:
- "when did we see sablefish marks near Cape Edgecumbe?"
- "show me all sessions where I mentioned the engine sounding different"
- "find the last time we fished this exact GPS area"

## Multi-Stream Sync (the supervised learning layer)

The key insight: ActiveLog sessions are timestamped. Sounder data is timestamped. Camera footage is timestamped. If all three use UTC, they can be aligned post-hoc.

```
Timeline:
14:00:00 ─── transcript: "setting first string" ────────────
14:00:00 ─── sounder: depth 18fm, marks at 8fm ────────────
14:00:00 ─── camera: (not deployed) ────────────────────────
14:32:00 ─── transcript: "hauling, looks like good sablefish"
14:32:00 ─── sounder: depth 18fm, dense marks ─────────────
14:32:00 ─── camera: deployed at 18fm, footage shows fish ──
```

ActiveLog becomes the **temporal spine** that all other data streams align to. The transcript provides the human narrative; the sounder provides the machine data; the camera provides ground truth. Together they form a labeled training corpus.

## Tech Stack

- **Frontend:** Single HTML page (Cloudflare Pages), vanilla JS, Web Speech API, IndexedDB
- **Backend:** Cloudflare Worker (API + D1 + Vectorize)
- **Auth:** Cloudflare Access (Tier 1), API tokens (Tier 2)
- **Storage:** IndexedDB (local), D1 (cloud), R2 (audio exports)
- **Vectorize:** bge-small-en-v1.5 (384 dims)
- **Deploy:** `wrangler pages deploy` + `wrangler deploy`

## Deployment Steps

1. Create D1 database: `wrangler d1 create activelog`
2. Create Vectorize index: `wrangler vectorize create activelog-embeddings --dimensions 384`
3. Create R2 bucket: `wrangler r2 bucket create activelog-audio`
4. Deploy Worker: `wrangler deploy`
5. Deploy Pages: `wrangler pages deploy .`
6. Configure Cloudflare Access policy
7. Point activelog.ai domain to Pages

## File Structure

```
activelog-ai/
├── src/
│   ├── index.html          # Main app (Pages)
│   ├── app.js              # Client-side logic
│   ├── speech.js           # Web Speech API wrapper
│   ├── geo.js              # Geolocation manager
│   ├── session.js          # Session management
│   ├── sync.js             # D1 sync queue
│   └── styles.css          # Dark maritime theme
├── worker/
│   └── src/
│       └── index.ts        # Cloudflare Worker API
├── schema.sql              # D1 migrations
├── wrangler.toml           # Worker config
├── package.json
└── README.md
```
