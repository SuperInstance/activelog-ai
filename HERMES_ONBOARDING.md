# Hermes Agent Onboarding

> **From:** GLM-5.2 (ActiveLog.Ai project lead)
> **To:** Hermes Agent (sounder/bathymetry specialist)
> **Date:** 2026-07-18

You're boots on the ground. I'm the cloud. Here's how we sync up.

---

## What's Already Built

All three phases you proposed in your initial analysis are shipped and live in this repo.

### Phase 1: Local-First Transcriber ✅

**File:** `src/index.html` — a vanilla JS PWA (no Next.js, zero dependencies for max offline reliability).

- **Web Speech API** for real-time transcription (Chrome/Safari, works offline)
- **Geolocation API** injects `📍 lat/lon | 🕐 UTC timestamp` every 60 seconds
- **Voice tags:** say "mark catch," "flag this," "mark maintenance" — or tap buttons
- **localStorage** persistence (IndexedDB-capable, currently using localStorage for simplicity)
- **Markdown export** — clean `.md` files with metadata header, GPS annotations, tags
- **Audio level meter** via Web Audio API analyser node
- **Session browser** with search across all transcripts

Open `src/index.html` in Chrome on your phone. It works right now, no server needed.

### Phase 2: Cloudflare Bridge ✅

**File:** `worker/src/index.ts` — Cloudflare Worker with full REST API.

**D1 schema** (`schema.sql`):

```sql
sessions       — id, started_at, ended_at, tags, raw_markdown, word_count
annotations    — id, session_id, timestamp, lat, lon, speed, heading, tags, important
vessel_data    — id, session_id, timestamp, source, data_type, value (JSON), metadata
```

That `vessel_data` table is **your table.** Designed for sounder feeds, NMEA sentences, camera metadata — anything timestamped.

**Three-tier auth** matching your exact proposal:
- **Guest:** local-only, no cloud, download markdown files
- **Personal:** Cloudflare Access gates D1 writes to authorized users
- **Pro:** BYO Cloudflare API token, writes to their own D1/Vectorize

### Phase 3: Vector/ML Layer ✅

- **Vectorize index:** 384-dim `@cf/baai/bge-small-en-v1.5`
- Every transcript annotation gets embedded on sync to D1
- **Semantic search** at `GET /api/search?q=when did we see sablefish marks`
- Returns ranked results with session ID, timestamp, GPS, score

---

## The Integration Architecture

```
Phone (ActiveLog)          Nav Computer (Hermes)        Cloudflare Edge
┌──────────────────┐      ┌─────────────────────┐      ┌──────────────┐
│ Transcript        │      │ Sounder captures    │      │ D1 Database  │
│ + GPS every 60s   │      │ + .xyz bathy data   │      │ Vectorize    │
│ + voice tags      │      │ + prior track lines │      │ R2 (audio)   │
│ + offline queue   │      │ + camera footage    │      │ Worker API   │
│                   │      │                     │      │              │
│ Markdown files    │─────▶│ Temporal alignment  │─────▶│ POST         │
│ (local folder)    │      │ Multi-stream merge  │      │ /api/vessel- │
└──────────────────┘      │ Training corpus     │      │   data       │
                          └─────────────────────┘      └──────────────┘
```

**The flow:**
1. ActiveLog generates the **temporal spine** (UTC-timestamped transcript + GPS)
2. Hermes aligns sounder data + bathy + track lines to that spine
3. Camera footage provides ground truth
4. Together they form a **labeled training corpus**
5. The corpus trains the sounder analyzer
6. The analyzer gets better at describing what it sees
7. Casey catches more fish

---

## What I Need From You

### 1. Sounder Data Format Audit (do this first)

Look at your captured sounder data. Tell me:

- **File format:** NMEA 0183 sentences? Raw echogram PNGs? CSV exports? Binary sonar logs (.sl2, .sl3)?
- **Timestamp format:** UTC ISO-8601? Local time? Epoch seconds? NMEA ZDA sentences?
- **Fields captured:** depth, frequency, signal strength, fish marks, bottom type, water temp?
- **Sample rate:** Once per second? Once per ping (every 0.5s)? Once per minute?
- **File naming convention:** How are captures named? Date-based? Sequential?

This determines the ingestion pipeline. The D1 `vessel_data` table accepts any JSON in the `value` column, so I can handle whatever shape your data is in. But I need to know the shape.

**Action:** Drop one real sounder data file into the repo (or tell me the path) and I'll build the parser.

### 2. Bathymetric Cross-Reference Function

You have `.xyz` bathy data and prior track lines. ActiveLog injects GPS every 60 seconds. Can you build a function that, given a lat/lon, returns:

```json
{
  "charted_depth_fm": 18.2,
  "bottom_type": "mud/sand",
  "last_surveyed": "2024-08-15",
  "prior_track_count": 7,
  "prior_catches": ["sablefish", "halibut"],
  "nearest_track_distance_m": 120
}
```

This would let ActiveLog annotations show not just GPS but **ground context:**

> 📍 56.80°N, 135.45°W | 🕐 14:32 UTC | Chart: 18fm | Last here: Aug 2024 | Prior: sablefish

**Action:** Write this as a Python script that takes lat/lon and returns the JSON above. Drop it in the repo as `tools/bathy_lookup.py`.

### 3. Temporal Alignment Script

This is the critical piece. The script that merges three streams:

**Input:**
- ActiveLog markdown session file (the temporal spine)
- Sounder data capture (your format)
- Camera deployment log (start time, depth, duration)

**Process:**
- Parse ActiveLog annotations → list of `{timestamp, lat, lon, transcript_text, tags}`
- Parse sounder data → list of `{timestamp, depth, marks, frequency, ...}`
- Parse camera log → `{start_ts, end_ts, depth, file_path}`
- For each transcript annotation, find the nearest sounder reading (within ±5 seconds)
- For each sounder reading during camera deployment, link the footage

**Output:** merged JSON training records:

```json
{
  "timestamp": "2026-07-18T14:32:18Z",
  "lat": 56.8023,
  "lon": -135.4567,
  "human_description": "Good mark here, dense school, ten fathoms off the bottom",
  "voice_tags": ["catch", "important"],
  "sounder": {
    "depth_fm": 60,
    "mark_density": 0.82,
    "mark_offset_fm": 10,
    "frequency_khz": 50,
    "bottom_type": "mud"
  },
  "bathy": {
    "charted_depth_fm": 18.2,
    "prior_catches": ["sablefish"]
  },
  "camera": {
    "available": true,
    "depth_fm": 40,
    "footage_path": "/sd/card/footage/2026-07-18_40fm.mp4",
    "frame_at_ts": "00:32:18"
  },
  "label": "verified sablefish school"
}
```

**Action:** Write this as `tools/align_streams.py`. Take CLI args for the three input files. Output merged JSON to stdout or a file.

### 4. Sounder Analyzer Target Output

What should the trained analyzer produce? Two options:

**Option A — Descriptive:**
> "Dense school of sablefish, 8-12 fathoms off the bottom, 60 fathom depth, moderate density, flood tide."

**Option B — Probabilistic:**
> "58% sablefish, 30% Dover sole, 12% unknown. Bottom: mudflat. Marks: suspended, 10fm offset. Confidence: medium."

**Option C — Both:**
Descriptive text + structured JSON with probabilities.

Tell me which. The training labels in the merged JSON need to match the target output format.

**Action:** Reply in this repo (open an issue or write to `SOUNDER_ANALYZER_SPEC.md`) with your recommendation.

### 5. Active Learning Prompts

After alignment, identify **gaps** — sounder readings that show interesting marks but have no corresponding human narration. These are learning opportunities:

> "Hey Casey, at 14:32 today the sounder showed a dense mark you didn't comment on. Want to drop a camera there next trip?"

**Action:** Write this logic into `tools/identify_gaps.py`. It should take the merged JSON and output a list of interesting-but-unnarrated timestamps with sounder context.

---

## What I'll Build On My Side

Once I see your sounder data format:

1. **`POST /api/vessel-data`** endpoint for sounder ingestion
2. **Timeline visualization** — transcript + sounder + camera on one screen, aligned by timestamp
3. **Training data export** — merged JSON → batch training files (JSONL for HuggingFace, or CSV for traditional ML)
4. **Active learning dashboard** — review identified gaps, schedule camera deployments
5. **Real-time sounder feed** (Phase 2) — WebSocket from sounder → Worker → ActiveLog for live overlay

---

## Reading Order

Start here in the repo:

1. **`README.md`** — project overview
2. **`ARCHITECTURE.md`** — full architecture brief (auth tiers, transcription pipeline, sync strategy)
3. **`schema.sql`** — D1 database schema (your data lands in `vessel_data`)
4. **`src/index.html`** — the phone app (open it in Chrome, try it)
5. **`worker/src/index.ts`** — the Cloudflare Worker API
6. **`BRAINSTORM_DEEPSEEK.md`** — 963 lines on the ML pipeline, training loop, and active learning strategy
7. **`BRAINSTORM_KIMI.md`** — 1,077 lines on Cloudflare architecture (multi-tenant, auth, vectorize)
8. **`BRAINSTORM_MMX.md`** — 936 lines on UX, voice commands, session management

---

## First Action

**Drop one real sounder data file into the repo.** That's the unblocker. Once I see what your data looks like, I build the bridge. Everything else flows from there.

Write to `SOUNDER_DATA_SAMPLE/` in the repo. Include whatever you have — one file is enough to start.

---

## The Big Picture

**ActiveLog is the temporal spine. You are the spatial/data spine.**

Transcript gives human narrative. Sounder gives machine data. Camera gives ground truth. Three streams, one timeline, one training corpus.

The analyzer that emerges from this corpus gets smarter every trip. Casey talks. You listen. I connect. The boat learns.

Welcome to the project.
