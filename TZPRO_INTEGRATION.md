# TZ-Pro Integration — Adapting ActiveLog.Ai for the Existing Vessel Nervous System

> **Critical discovery:** The vessel already HAS a nervous system. ActiveLog.Ai must connect to it, not replace it.

---

## What's Already Running on the Boat

Based on the tzpro agent's self-description, the following processes are live:

| Process | Role | Data Produced |
|---------|------|---------------|
| **capture daemon** (PID 33360) | Captures dual-band echogram PNGs every 10 minutes | 1920×1080 PNG files, dual-band (50kHz left, 200kHz right), JSON metadata |
| **NMEA bridge** (port 6006) | Streams vessel telemetry at 1 Hz | lat/lon, heading, speed, depth, water temp, wind → SQLite + JSON |
| **analyzer.py** (PID 372) | OpenCV blob detection on echograms, every 60 seconds | Blob features (centroid, area, intensity, depth), thermocline detection, bottom detection → augmented JSON + markdown log |
| **captures.db** | SQLite hippocampus | `captures` table (30+ rows), `blobs` table (21,984+ rows), `detections` table |
| **vocabulary module** | Bayesian species classifier | Posterior distributions per species. Currently: chum at P=0.95 |
| **alerts daemon** | Reflex arc rules (4 rules) | Seafloor proximity, school density, thermocline breach, capture gap |
| **hermitd** | Resident agent / chronicler | 8,342+ sensor observations, ship log search tasks |
| **SoundCrab** | Audio capture/playback | Audio-level monitoring |
| **capture_tray** | GUI indicator for capture daemon | Tray icon status |

### Data Formats Already in Use
- **Echogram captures:** PNG (1920×1080) + JSON metadata, schema_versioned (never overwrite, only append)
- **NMEA data:** JSON (from NMEA 0183 sentences) → SQLite rows
- **Analysis output:** Augmented JSON (schema v2, v3...) + markdown log sections
- **Blob features:** centroid_depth, mean_intensity, aspect_ratio, area, perimeter, circularity
- **Depth zones:** surface, upper, middle, lower, floor (18 pixels per fathom)
- **Timestamps:** UTC throughout the system

### Schema Conventions
- `schema_version` increments, never overwrites
- `ALTER TABLE ADD COLUMN` for migrations (neurogenesis)
- `CREATE INDEX` for performance (myelination)
- Foreign keys link blobs → captures → detections

---

## What ActiveLog.Ai Must Change to Fit

### 1. NMEA Bridge — ActiveLog should READ from the existing NMEA bridge, not create its own

The boat already has an NMEA bridge on port 6006 streaming at 1 Hz. ActiveLog's current geolocation uses the browser Geolocation API (phone GPS). This is redundant and less accurate.

**Change:** Add a "Vessel NMEA" connection option in ActiveLog settings:
- If on the boat's WiFi: connect to `ws://nav-computer:6006` or `http://nav-computer:6006/nmea`
- Use the vessel's own GPS/depth/temp/heading stream instead of phone GPS
- Fallback to phone Geolocation API when not connected to vessel WiFi
- The NMEA stream gives us **depth and water temp** in addition to GPS — currently missing from phone GPS

### 2. Annotation Format — Match the tzpro schema conventions

ActiveLog currently injects:
```
---
**📍 56.8023°N, 135.4567°W | 🕐 14:32:18 UTC | Speed: 8.2 kn**
---
```

**Change to include vessel data from NMEA bridge:**
```
---
**📍 56.8023°N, 135.4567°W | 🕐 14:32:18 UTC | Depth: 57.2fm | Water: 7.2°C | Speed: 8.2kn | Heading: 273°**
---
```

This makes ActiveLog annotations directly alignable with echogram captures (which also have depth and position).

### 3. Capture-Aware Annotations — Sync with the 10-minute capture cycle

The echogram capture daemon fires every 10 minutes. ActiveLog annotations fire every 60 seconds. But the **most valuable annotations** are the ones that coincide with a capture.

**Change:** ActiveLog should know the capture schedule. Every 10 minutes (aligned to the capture daemon), inject a **capture-aligned annotation:**
```
---
**📸 CAPTURE ALIGNMENT | 📍 56.80°N, 135.45°W | 🕐 14:30:00 UTC | Depth: 57.2fm | Echogram: 2026-07-18_1430.png**
---
```

This creates an explicit link between the transcript and the echogram file. Hermes's alignment script can use these as anchor points.

### 4. Vocabulary Integration — ActiveLog should see what the analyzer sees

The vocabulary module produces species predictions (currently chum at P=0.95). ActiveLog should optionally display these predictions.

**Change:** If connected to the vessel network, ActiveLog reads the latest vocabulary state:
```
Last capture: 2026-07-18_1430.png
Prediction: chum (P=0.95) | 7 blobs detected | Thermocline at 8fm
```

The captain can then voice-tag: "confirmed chum" or "no, that's wrong, looks like coho" — and this becomes a training label.

### 5. SounderAnalyzer Target Output — Match the existing blob/vocabulary structure

The existing system already produces:
- Blob features (centroid, area, intensity, depth)
- Species predictions (Bayesian posterior)
- Thermocline detection
- Bottom detection

ActiveLog's training corpus should produce labels that map to **these existing structures**, not a new format.

**Training label format (aligned with existing schema):**
```json
{
  "capture_id": "2026-07-18_1430",
  "timestamp": "2026-07-18T14:30:00Z",
  "lat": 56.8023,
  "lon": -135.4567,
  "depth_fm": 57.2,
  "water_temp_c": 7.2,
  "transcript_segment": "Good mark here, dense school, ten fathoms off the bottom",
  "voice_tags": ["catch", "important"],
  "captain_confirmation": "chum",
  "vocabulary_prediction": {
    "species": "chum",
    "probability": 0.95,
    "blob_count": 7,
    "thermocline_depth_fm": 8
  },
  "label_type": "species_confirmation",
  "label_value": "chum",
  "ground_truth_camera": {
    "available": true,
    "depth_fm": 35,
    "footage_path": "/sd/2026-07-18_35fm.mp4"
  }
}
```

### 6. The Supervisor Loop — ActiveLog as the Human Labeling Interface for the Existing Analyzer

The existing system is:
```
capture → analyze → vocabulary → (dead end: no human feedback)
```

ActiveLog completes the loop:
```
capture → analyze → vocabulary → ActiveLog (captain speaks) → training label → vocabulary update
```

The captain's voice IS the ground truth. When he says "those are chum" while looking at the sounder, that's a species label. When he says "nothing there, waste of fuel" that's a negative sample. When he says "weird mark, never seen that before" that's an anomaly flag.

**ActiveLog's real role:** it is the human-in-the-loop labeling interface for an autonomous marine AI. The gamification is there because labeling is boring. The FishCoin is there because labels have value. The transcript is the raw material. The training corpus is the product.

### 7. Data Directory Alignment

The boat's file system should look like:
```
/nav-data/
├── captures/
│   ├── 2026-07-18_1430.png          # echogram image
│   ├── 2026-07-18_1430.json         # echogram metadata
│   ├── 2026-07-18_1430_analysis.json # analyzer output
│   ├── 2026-07-18_1440.png
│   └── ...
├── transcripts/
│   ├── activelog-2026-07-18-1400.md  # ActiveLog session (temporal spine)
│   └── ...
├── captures.db                       # SQLite hippocampus
├── camera/
│   ├── 2026-07-18_35fm.mp4           # underwater camera footage
│   ├── 2026-07-18_40fm.mp4
│   └── deployments.json              # camera deployment log
├── merged/                           # Hermes's aligned output
│   └── 2026-07-18_aligned.jsonl
└── vocabulary/
    └── vocabulary.json               # Bayesian species lexicon
```

ActiveLog should save its markdown sessions to `/nav-data/transcripts/` so Hermes's watcher can find them.

---

## Implementation Changes Needed

### ActiveLog App (`src/index.html`)

1. **Settings: NMEA Source**
   - Option: "Phone GPS" (current) vs "Vessel NMEA" (new)
   - Vessel NMEA URL: configurable (default `ws://localhost:6006`)
   - When connected, use vessel depth + temp + heading in annotations

2. **Settings: Capture Sync**
   - Option: "Align with echogram captures"
   - Capture interval: 10 minutes (default, matches capture daemon)
   - Inject capture-aligned annotation at each capture time

3. **Settings: Transcript Path**
   - Where to save markdown files on the nav computer
   - Default: `/nav-data/transcripts/`
   - Also stores in localStorage for offline use

4. **Live vocabulary overlay**
   - Small panel showing latest vocabulary prediction
   - Captain can confirm/deny with voice ("confirmed chum" / "wrong species")

5. **Camera deployment log**
   - Structured `[camera:deploy depth=Nfm]` tags (already added)
   - Also write to `/nav-data/camera/deployments.json` on the nav computer

### Worker API (`worker/src/index.ts`)

6. **`POST /api/vessel-data`** endpoint (for Hermes)
   - Accepts sounder captures, NMEA batches, analysis results
   - Writes to `vessel_data` table
   - Also embeds text descriptions for Vectorize search

7. **`GET /api/vocabulary`** endpoint
   - Reads latest vocabulary state
   - Returns species list with probabilities

8. **`POST /api/training-label`** endpoint
   - Accepts aligned training records (transcript + sounder + camera + label)
   - Stores in a `training_labels` table
   - Triggers vocabulary update notification

### New D1 Tables

9. **`training_labels`** table:
```sql
CREATE TABLE training_labels (
  id TEXT PRIMARY KEY,
  capture_id TEXT,
  session_id TEXT,
  timestamp TEXT NOT NULL,
  label_type TEXT NOT NULL,  -- 'species_confirmation', 'negative', 'anomaly'
  label_value TEXT NOT NULL, -- 'chum', 'empty', 'unknown'
  transcript_segment TEXT,
  voice_tags TEXT,
  sounder_data TEXT,         -- JSON blob from analyzer
  vocabulary_prediction TEXT, -- JSON blob at time of labeling
  camera_available INTEGER DEFAULT 0,
  camera_depth REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
```

10. **`captures`** table (mirror of the boat's captures.db):
```sql
CREATE TABLE captures (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  lat REAL,
  lon REAL,
  depth_fm REAL,
  water_temp_c REAL,
  png_url TEXT,              -- R2 path if uploaded
  analysis_json TEXT,        -- Full analyzer output
  blob_count INTEGER,
  vocabulary_prediction TEXT, -- JSON
  synced_at TEXT
);
```

---

## The Completed Loop

```
  ┌─────────────────────────────────────────────────────────────┐
  │                    THE VESSEL NERVOUS SYSTEM                  │
  │                                                              │
  │  capture daemon ──▶ analyzer.py ──▶ vocabulary module        │
  │       │                   │                   │              │
  │   echogram PNGs      blob features      species prediction   │
  │       │                   │                   │              │
  │       └───────────────────┴───────────────────┘              │
  │                          │                                   │
  │                    captures.db                                │
  │                          │                                   │
  │  ┌───────────────────────┼───────────────────────────┐       │
  │  │              HERMES (nav computer)                  │       │
  │  │  Watcher → align_streams.py → merged JSONL         │       │
  │  │  bathy_lookup.py → ground truth context            │       │
  │  │  identify_gaps.py → active learning prompts        │       │
  │  └───────────────────────┼───────────────────────────┘       │
  │                          │                                   │
  │  ┌───────────────────────┼───────────────────────────┐       │
  │  │            ACTIVELOG.Ai (phone/tablet)             │       │
  │  │                                                     │       │
  │  │  Captain speaks → transcript + GPS + depth + temp  │       │
  │  │  Voice tags: "confirmed chum" / "wrong species"    │       │
  │  │  Camera deploy: structured [camera:deploy] tags    │       │
  │  │                                                     │       │
  │  │  THIS IS THE HUMAN LABELING INTERFACE               │       │
  │  │  Every word the captain says about what he sees     │       │
  │  │  is a training label for the analyzer               │       │
  │  └───────────────────────┼───────────────────────────┘       │
  │                          │                                   │
  │  ┌───────────────────────┼───────────────────────────┐       │
  │  │         CLOUDFLARE EDGE (GLM-5.2)                   │       │
  │  │  D1: sessions + annotations + vessel_data          │       │
  │  │  D1: training_labels + captures (mirror)           │       │
  │  │  Vectorize: semantic search across everything      │       │
  │  │  R2: echogram PNGs + audio + camera footage        │       │
  │  │  Worker: API + timeline viz + training export      │       │
  │  └───────────────────────────────────────────────────┘       │
  │                                                              │
  │  THE LOOP:                                                   │
  │  1. Capture daemon takes echogram                            │
  │  2. Analyzer finds blobs                                     │
  │  3. Vocabulary predicts species                              │
  │  4. ActiveLog records captain's reaction                     │
  │  5. Captain confirms or corrects prediction                  │
  │  6. Hermes aligns all streams                                │
  │  7. Training label feeds back to vocabulary                  │
  │  8. Vocabulary gets more confident                           │
  │  9. Next capture → better prediction                         │
  │  10. GOTO 1                                                  │
  │                                                              │
  └─────────────────────────────────────────────────────────────┘
```

ActiveLog is not a logging app. It is the **human labeling interface** for an autonomous marine AI system that already exists. The gamification exists because labeling is the most important and most boring task in machine learning, and games make boring things feel like progress.

The boat already has eyes (capture daemon), a visual cortex (analyzer), and memory (vocabulary). What it's missing is a mouth — a way for the captain to tell it what it's looking at.

ActiveLog is the mouth.

---

*Written 2026-07-18 after discovering the tzpro agent's existing nervous system. The boat is more awake than we knew. Our job is to connect the pieces, not build new ones.*
