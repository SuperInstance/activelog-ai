# ActiveLog.Ai ← TZ-Pro Integration Update

> Adapting to the REAL vessel system, not the literary version.
> Based on `_AGENTS_GUIDE.md` from the tzpro-agent repo.

---

## The Real System (Not the Essays)

The boat runs on **EILEEN** (Windows 11, Ketchikan). Here's what's actually live:

### Processes
| PID | Process | Role |
|-----|---------|------|
| 33360 | `capture_v3.py` | Screenshots TZ Pro every 10 min (configurable: sounder-only every 30s, full frame every 4 min) |
| 372 | `analyzer.py` | OpenCV analysis every 60s. Dual-band (LF/HF) blob detection, thermoclines, bottom, haze, boat proximity |
| 3172 | `nmea_bridge.py` | COM6 (u-blox GPS) → TCP :6006. `$GPGGA`/`$GPRMC` sentences |
| 9644 | `hermitd` | Vessel dashboard at TCP :8654. Status at `http://127.0.0.1:8654/vessel` |
| — | `alerts.py` | 5 rule types, 60s loop, dedup via `.alert_state.json` |
| — | `vocabulary.py` | Bayesian species prediction. Currently: chum at P=0.95 |
| — | `catch_link.py` | Links catch reports to nearest capture |
| — | `conservation_layer.py` | γ+H=C, SplitTrigger, SpectralLaplacian |
| — | `fleet_monitor.py` | Service health checker |

### Data Endpoints ActiveLog Can Use

**1. Vessel Status (the good one):**
```
GET http://127.0.0.1:8654/vessel
```
Returns JSON with lat, lon, SOG, COG, depth, water temp, wind. This is what ActiveLog should poll instead of the phone's Geolocation API.

**2. NMEA TCP Stream:**
```
TCP localhost:6006
```
Raw NMEA-0183 sentences. For ActiveLog, the HTTP endpoint above is cleaner.

**3. Capture Directory:**
```
C:\Users\casey\.openclaw\workspace\tzpro-agent\captures\v3\
  YYYY-MM-DD_LAT\
    HHMM_LAT.json    ← full analysis (schema v3)
    HHMM_LAT.png     ← raw echogram screenshot
    HHMM_LAT.md      ← human-readable log
```

**4. SQLite Database:**
```
C:\Users\casey\.openclaw\workspace\tzpro-agent\captures.db
Tables: captures, blobs, catch_labels
```

**5. Vocabulary State:**
```
.vocabulary_cache.json  ← cached Bayesian state
python vocabulary.py summarize
python vocabulary.py lookup <depth_fm>
```

### Actual Capture JSON Structure (schema v3)

```json
{
  "capture_id": "HHMM_DDMM.mmmN_DDDMM.mmmW",
  "ts_utc": "2026-07-17T20:40:05Z",
  "position": {
    "lat_dd": 55.781,
    "lon_dd": -131.688,
    "sog_kts": 2.5,
    "cog_deg": 135.0
  },
  "analysis": {
    "schema_version": 3,
    "heuristic": {
      "lf": {
        "zone_profiles": {"surface": {}, "upper": {}, "mid": {}, "lower": {}, "floor": {}},
        "blobs": [{"centroid_depth_fm": 35.2, "area_px": 120, "mean_intensity": 112.5}],
        "thermoclines": [{"center_depth_fm": 17.6}],
        "bottom": {"bottom_depth_fm": 57.2},
        "boat_proximity": {"vertical_line_count": 3}
      },
      "hf": {
        "haze": {"haze_blob_count": 65, "feed_present": true},
        "blobs": [...]
      }
    },
    "caption": "Bottom 57.2fm. 7 thermoclines. 443 LF blobs. Vocabulary: chum.",
    "vocabulary": [{"species": "chum", "depth_fm": 35, "count": 15}]
  }
}
```

### Depth Zones (Critical for ActiveLog)
| Zone | Depth | Pixel Rows | Signal |
|------|-------|-----------|--------|
| Surface | 0-5 fm | 0-90 | Haze, plankton, surface clutter |
| Upper | 5-20 fm | 90-360 | Mixed returns, thermoclines |
| Mid | 20-40 fm | 360-720 | **Primary chum zone** |
| Lower | 40-55 fm | 720-990 | Deep fish, structure |
| Floor | 55-60 fm | 990-1080 | Bottom detection |

### NMEA Source
- u-blox GPS on COM6
- HTTP bridge via hermitd: `http://127.0.0.1:8654/vessel`
- No checksum validation yet (P1 issue)

### Known System Issues (P0)
1. NO_ANALYSIS alert spams every 60s
2. Ship Log POST failures lost (no retry)
3. Non-atomic file writes
4. Bare except swallows vocab errors
5. Laplace inflates single-species confidence to 0.95

---

## ActiveLog.Ai Changes (Real System)

### 1. Vessel Data Source

**Replace phone GPS with vessel HTTP endpoint when on boat WiFi.**

```javascript
// In ActiveLog settings:
// Option: "Vessel Data Source"
//   - "Phone GPS" (default, uses Geolocation API)
//   - "Vessel NMEA" (polls http://127.0.0.1:8654/vessel)

async function getVesselData() {
  if (settings.vesselSource !== 'nmea') return null;
  try {
    const resp = await fetch('http://127.0.0.1:8654/vessel', { timeout: 3000 });
    const data = await resp.json();
    return {
      lat: data.lat || data.latitude,
      lon: data.lon || data.longitude,
      speed: data.sog || data.speed_kts,
      heading: data.cog || data.course_deg,
      depth: data.depth_fm || data.depth,
      waterTemp: data.water_temp_c || data.water_temp,
    };
  } catch(e) { return null; }
}
```

When ActiveLog detects it's on the boat WiFi (check if `127.0.0.1:8654` responds), automatically switch to vessel data source. This gives us **depth and water temp** in annotations — data the phone GPS can't provide.

### 2. Annotation Format (Match Real Schema)

```markdown
---
**📍 55.781°N, 131.688°W | 🕐 20:40:05 UTC | Depth: 57.2fm | Water: 7.2°C | SOG: 2.5kn | COG: 135°**
---
```

### 3. Capture-Aware Mode

The capture daemon fires on :00/:10 boundaries. ActiveLog should:
- Poll `captures/v3/` directory for new JSON files
- When a new capture appears, inject a capture-aligned annotation:

```markdown
---
**📸 CAPTURE: HHMM_DDMM.mmmN_DDDMM.mmmW | 📍 55.781°N, 131.688°W | 🕐 20:40 UTC | Depth: 57.2fm | LF blobs: 443 | Vocabulary: chum (P=0.95) | Thermoclines: 7 | Bottom: 57.2fm | Feed: present**
---
```

This directly links the transcript to the echogram capture by ID.

### 4. Vocabulary Feedback Loop

When the vocabulary predicts a species, ActiveLog displays it and the captain can confirm/correct:

```
[System] Vocabulary predicts: chum (P=0.95) at 35fm based on 7 blobs in mid-zone

Captain speaks: "Yeah those are chum, tight school, maybe fifteen fish"

→ Training label generated:
{
  "capture_id": "1240_5546.864N_13141.209W",
  "label_type": "species_confirmation",
  "species": "chum",
  "captain_text": "those are chum, tight school, maybe fifteen fish",
  "count_estimate": 15,
  "depth_fm": 35,
  "vocabulary_was": {"species": "chum", "confidence": 0.95}
}
```

Or correction:
```
[System] Vocabulary predicts: chum (P=0.95)

Captain speaks: "No those aren't chum, looks more like sockeye, see the different mark shape"

→ Training label:
{
  "label_type": "species_correction",
  "species": "sockeye",
  "captain_text": "those aren't chum, looks more like sockeye, see the different mark shape",
  "vocabulary_was": {"species": "chum", "confidence": 0.95}
}
```

This is the human-in-the-loop that fixes the P0 vocabulary inflation issue.

### 5. Catch Link Integration

The existing `catch_link.py` accepts:
```bash
python catch_link.py link chum 35 15    # species, depth, count
python catch_link.py parse "chum at 35 fm, 15 fish"
```

ActiveLog voice command "mark catch chum 35 fathoms 15 fish" should trigger catch_link.py on the nav computer. This creates the formal catch label in captures.db.

### 6. Alert Display

The 5 alert types should show in ActiveLog when they fire:
- VOCABULARY_MATCH: "7 chum blobs detected at 35fm"
- BOAT_PROXIMITY: "3 other vessels detected on sounder"
- INTENSITY_SPIKE: "Mid-zone intensity doubled since last capture"
- BOTTOM_CHANGE: "Bottom depth changed 8 fathoms"
- NO_ANALYSIS: "No echogram capture for 15 minutes"

### 7. Output to D1 (Cloud Sync)

The D1 `vessel_data` table should mirror the captures.db schema:

```sql
-- Mirror of tzpro captures.db
CREATE TABLE IF NOT EXISTS captures (
  capture_id TEXT PRIMARY KEY,
  ts_utc TEXT NOT NULL,
  lat REAL, lon REAL,
  sog_kts REAL, cog_deg REAL,
  bottom_depth_fm REAL,
  blob_count_lf INTEGER,
  thermocline_count INTEGER,
  vocabulary_species TEXT,
  vocabulary_confidence REAL,
  caption TEXT,
  raw_json TEXT,           -- full analysis JSON
  png_r2_key TEXT,         -- R2 path if uploaded
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS catch_labels (
  capture_id TEXT,
  species TEXT,
  depth_fm INTEGER,
  count INTEGER,
  source TEXT DEFAULT 'activelog',  -- 'activelog' or 'manual'
  confirmed_by TEXT,                 -- captain voice confirmation
  synced_at TEXT
);

CREATE TABLE IF NOT EXISTS training_labels (
  id TEXT PRIMARY KEY,
  capture_id TEXT,
  session_id TEXT,
  timestamp TEXT NOT NULL,
  label_type TEXT,          -- 'confirmation', 'correction', 'negative', 'anomaly'
  species TEXT,
  captain_text TEXT,
  vocabulary_was_species TEXT,
  vocabulary_was_confidence REAL,
  depth_fm REAL,
  created_at TEXT
);
```

---

## The Completed Architecture

```
EILEEN (Windows 11 Nav Computer)              Cloudflare Edge
┌──────────────────────────────────┐         ┌──────────────────┐
│                                    │        │                  │
│  TZ Pro ──▶ capture_v3.py ──▶ PNG │        │  D1 Database     │
│              (every 10 min)        │        │  - sessions      │
│                   │                │        │  - annotations   │
│                   ▼                │        │  - captures      │
│              analyzer.py           │        │  - catch_labels  │
│              (every 60s)           │        │  - training_lbls │
│                   │                │        │                  │
│                   ▼                │        │  Vectorize       │
│              captures.db           │ ─────▶ │  (semantic search)│
│              (SQLite)              │  sync  │                  │
│                   │                │        │  R2              │
│                   ▼                │        │  (PNGs, audio)   │
│              vocabulary.py         │        │                  │
│              (Bayesian)            │        │  Worker API      │
│                   │                │        │  - search        │
│                   ▼                │        │  - vessel-data   │
│   ┌──────────────────────────┐     │        │  - training      │
│   │  ActiveLog.Ai (phone)    │     │        │  - timeline      │
│   │                          │     │        │                  │
│   │  Polls :8654/vessel      │     │        └──────────────────┘
│   │  Reads capture dir       │     │                 ▲
│   │  Shows vocab prediction  │     │                 │
│   │  Captain speaks → text   │─────┼─────────────────┘
│   │  Voice tags → labels     │     │  POST /api/annotations
│   │  Camera deploy tags      │     │  POST /api/training-label
│   │                          │     │  POST /api/captures
│   └──────────────────────────┘     │
│                                    │
│   ┌──────────────────────────┐     │
│   │  Hermes Agent            │     │
│   │  - align_streams.py      │     │
│   │  - bathy_lookup.py       │     │
│   │  - identify_gaps.py      │     │
│   │  - watcher module        │     │
│   └──────────────────────────┘     │
│                                    │
└────────────────────────────────────┘
```

## What Changes in Priority

Based on the real P0 issues:

1. **ActiveLog's first job:** be the vocabulary feedback loop. The system's biggest weakness is that `vocabulary.py` inflates single-species confidence to 0.95 because there's no human correction mechanism. ActiveLog IS that mechanism. "Confirmed chum" / "Wrong, that's sockeye" — every voice tag feeds back.

2. **ActiveLog's second job:** temporal context for captures. Working Theory #6 says "single frames are meaningless, need rolling window." ActiveLog's transcript IS the rolling window — the captain's narration between captures provides exactly the temporal context the analyzer lacks.

3. **ActiveLog's third job:** catch linking automation. Currently `catch_link.py` is run manually. ActiveLog's voice command "mark catch chum 35 fathoms 15 fish" can automate this in real-time.
