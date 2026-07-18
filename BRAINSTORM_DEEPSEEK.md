# BRAINSTORM: ActiveLog.Ai Supervised Learning Pipeline
## Sounder-to-AI: Teaching a Machine to See What a Fisherman Sees

**Author:** DeepSeek-V4 (AI/ML Architect)
**Date:** 2026-07-18
**Context:** Edge AI on a commercial fishing vessel. Offline-first. Gen-2 training corpus pipeline for ActiveLog.Ai.

---

## 0. Core Philosophy: The Boat Is the Reference Implementation

This is not a cloud-first pipeline with sporadic offline. This is an **offline-first, edge-native** system where connectivity is the exception, not the rule.

> **Constraint creates precision.** The boat forces us to solve hard problems — synchronization without NTP, labeling without annotation tools, training without GPUs — that the cloud-native world hand-waves away. Every solution here is designed to degrade gracefully to zero connectivity and scale up when bandwidth appears.

---

## 1. Data Streams: The Four Modalities

### Stream A: Transcript (ActiveLog)
| Property | Value |
|----------|-------|
| **Source** | Casey narrating via headset + ActiveLog app |
| **Format** | Timestamped text log + optional audio chunks |
| **Sampling** | Event-driven (Casey speaks), irregular intervals |
| **Example** | `"14:23:05 — looks like a strong return at 40 fathoms, think it's sockeye, bottom is hard"` |
| **Metadata** | GPS coord, water temp, tide stage attached to each entry |
| **Size** | ~1–5 KB per 8-hour trip. Negligible. |

### Stream B: Sounder (Echogram)
| Property | Value |
|----------|-------|
| **Source** | Furuno / Simrad / Garmin sounder NMEA 0183/2000 or proprietary export |
| **Format** | Raw sonar returns (frequency, amplitude, depth bins) + rendered echogram image |
| **Sampling** | Typically 1–10 pings/second. Each ping = array of depth samples. |
| **Channels** | Low freq (50 kHz, wide beam) + High freq (200 kHz, narrow beam) — critical for fish vs. bottom discrimination |
| **Size** | ~10–100 MB/hour raw, ~1–5 MB/hour as rendered echogram frames |
| **Key Signals** | Fish arches, bottom hardness, thermocline, plankton layer, bait ball density |

### Stream C: Camera (Ground Truth)
| Property | Value |
|----------|-------|
| **Source** | GoPro / underwater camera on drop line or towed sled, SD card recording |
| **Format** | H.264/H.265 video at 1080p–4K, or frame extraction on ingest |
| **Sampling** | Continuous while deployed (typically 30–120 min per drop) |
| **Size** | Massive. ~4–8 GB/hour at 1080p. This is the storage bottleneck. |
| **Purpose** | **Gold-standard ground truth.** Did we see fish? What species? Size? Behavior? |
| **Challenge** | Synchronized to sounder depth & time. Camera is at known depth (drop line length), sounder is looking at that same column. |

### Stream D: Environmental Context
| Property | Value |
|----------|-------|
| **Sources** | GPS, water temp sensor, tide tables (preloaded), weather (GRIB files pulled before departure) |
| **Format** | Time-series numeric data + categorical |
| **Example** | `47.5°N 122.3°W, 8.2°C surface, 4.1°C at 40fm, ebb tide -0.3m, wind 12kt NW` |
| **Purpose** | Feature-rich context for the model. Fish behavior is highly conditional on environment. |

### Stream Capacity Summary

| Stream | Data Rate | Daily Trip (12h) | Per Season (60 trips) |
|--------|-----------|-------------------|----------------------|
| Transcript | ~0.5 MB | ~6 MB | ~360 MB |
| Sounder (raw) | ~50 MB/h | ~600 MB | ~36 GB |
| Sounder (echogram images) | ~5 MB/h | ~60 MB | ~3.6 GB |
| Camera | ~6 GB/h | ~72 GB (if recording 12h) | ~4.3 TB |
| Environmental | ~10 KB/h | ~120 KB | ~7 MB |

**Critical insight:** Camera footage dominates storage (likely 90%+). Everything else fits easily on a 256 GB SD card + external SSD. The camera stream is the bottleneck and must be the primary target for compression, pruning, and selective retention.

---

## 2. Data Synchronization: The Offline Alignment Problem

### The Core Problem

Four streams collected on independent clocks:
- **Transcript clock**: ActiveLog app wall clock on Casey's phone
- **Sounder clock**: Sounder device internal clock (often drifting, rarely NTP-synced)
- **Camera clock**: GoPro/drop-cam wall clock (usually accurate via GPS time sync, but offline drops can drift)
- **Environmental clock**: GPS time (most accurate, common reference)

Offsets: clocks can drift 1–30 seconds over a day. NMEA streams have no reliable timestamp (many don't embed PPS).

### Solution: GPS-Referenced Multi-Phase Synchronization

#### Phase 1: Pre-Trip — Clock Correlation Record
Before departure, take a "clock correlation snapshot":
1. Record GPS timestamp (PPS-level accuracy)
2. Simultaneously record each device's internal timestamp
3. Record phone's NTP-synced timestamp
4. Store all four as a **calibration vector**

This gives us the offset at time T₀. For short trips (4–12 h), linear drift correction is adequate.

#### Phase 2: During Collection — Event-Bound Synchronization
Every significant event is tagged with a **human-observable marker** that appears in multiple streams:

- **"Dropping camera now"** — Casey says it (transcript timestamp) AND the deckhand drops (sounder sees the camera line descending). Use the sounder signature of a descending object as an independent timestamp anchor.
- **"Fish on!"** — Transcript exclamation + sounder arch at corresponding depth + (if camera deployed) fish visible.
- **"Passing over that ledge"** — Transcript + GPS track + sounder bottom change.

These natural anchors can be used for **nonlinear alignment** in post-processing (described in Phase 3).

#### Phase 3: Post-Trip — Full Ingestion Alignment

When data arrives at the home/marina server (or after bulk upload):

```
1. Correlate GPS time series with each stream
2. Apply clock correction: corrected_ts = raw_ts + (gps_ref - device_ref) + drift * (raw_ts - t0)
3. Find all event-bound anchors across streams
4. Run Dynamic Time Warping (DTW) on overlapping event sequences
5. Refine alignment to sub-second precision where event markers exist
6. Output: a unified timeline with all streams synchronized
```

For sections between anchors, use linear interpolation. For sections WITHIN a camera drop (the critical zone), the camera timestamps are the master clock because the camera provides ground truth.

#### Streaming Offset Budget

Allow ±15 seconds of uncertainty between transcript and sounder for initial ingestion. Post-synchronization should reduce this to <1 second for labeled segments.

### Practical Ingestion Flow

```
vessel/
  trips/
    trip_2026_07_18/
      audio/            ← Casey's narration (raw)
      transcript.alog   ← ActiveLog transcript output
      sounder/
        raw/            ← Binary sonar pings
        echograms/      ← Rendered echogram frames every 1s
      camera/
        drop_01.MP4     ← 40 fathom drop, 14:22–15:18
        drop_02.MP4     ← 60 fathom drop, 15:35–16:42
      environmental.csv ← GPS + temp + tide merged log
      gps_track.gpx
      calibration.json  ← Pre-trip clock calibration
```

---

## 3. Labeling Strategy: Asynchronous Human-in-the-Loop

### The Labeling Interface (ActiveLog Desktop)

Casey should not need to be a data scientist. The labeling interface should be:

1. **Timeline view** — unified scrollable timeline with all 4 streams
2. **Region selection** — click-drag to select a time range + depth range
3. **Label palette** — species, bottom type, confidence, notes
4. **Camera thumbnail** — when selecting a region with camera footage, show the corresponding video frame

### Label Types

| Label | Granularity | Example | Source |
|-------|-------------|---------|--------|
| **Species presence** | Time range + depth range | `sockeye_salmon @ 35–45fm, 14:22:10–14:22:45` | Casey labels |
| **Bottom type** | Time range | `hard_bottom @ 14:20–14:30` | Casey labels, sounder auto-classify |
| **Fish count/abundance** | Integer or categorical | `abundant (50+ fish) @ 40fm` | Casey estimate |
| **Behavior** | Categorical | `schooling`, `feeding`, `transiting` | Camera verification |
| **Confidence** | 1–5 scale | `3 = uncertain, might be chum not sockeye` | Casey's assessment |
| **Environment** | Fixed per region | `temp=4.2°C, tide=ebb` | Auto-populated from sensors |
| **Camera match** | Binary | `true` if camera confirms | Derived automatically |

### Label Format (Event-Driven Storage)

```json
{
  "id": "label_20260718_001",
  "trip_id": "trip_2026_07_18",
  "timestamp_range": ["14:22:10.5", "14:22:45.2"],
  "depth_range": [35.0, 45.0],
  "species": "oncorhynchus_nerka",
  "common_name": "sockeye salmon",
  "abundance": "abundant",
  "behavior": "schooling",
  "bottom_type": "hard",
  "environment": {
    "surface_temp_c": 8.2,
    "depth_temp_c": 4.1,
    "tide_state": "ebb",
    "tide_height_m": -0.3,
    "wind_knots": 12
  },
  "camera_confirmed": true,
  "user_confidence": 4,
  "notes": "huge school, classic arches on sounder",
  "labeled_at": "2026-07-19T09:30:00Z"
}
```

### Asynchronous Labeling Workflow

```
Trip Day (Offline)             Evening (Marina)          Next Days (Home/Workshop)
──────────────────────         ───────────────           ──────────────────────────
Collect all streams            1. Plug SD cards into      1. Open ActiveLog Desktop
Local storage on phone         home server/phone          2. Browse trips
+ sounder SD card              2. ActiveLog ingestion:   3. Unified timeline appears
+ camera SD card                  merge, synchronize      4. Click interesting regions
GPS track auto-merged          3. Process echograms      5. Camera frame appears (if exists)
                                4. Index for browsing     6. Add label
                                5. Push to Vectorize?     7. System suggests labels? (Phase 2)
                                (if internet available)   8. Export labeled corpus
```

### Critical Design Decision: Label Granularity vs. Model Input

Labels are on **time ranges and depth ranges**, not individual pings. This is intentional:

- **Noisier signal** (the label applies to a window, not an instant)
- **Easier for Casey** (he doesn't need to annotate every ping — just highlight a region of interest)
- **Better generalization** (the model learns to predict from context windows, not exact frames)
- **Temporal context** (a single ping is ambiguous; a 30-second window with 300 pings + track history is not)

---

## 4. Sounder Analyzer: Architecture

### The Dual-Path Design

The sounder analyzer uses **two parallel pathways** that fuse at the decision layer:

```
  ┌──────────────────┐      ┌──────────────────┐
  │  Path A: Vision   │      │  Path B: Time-   │
  │  (Echogram Image) │      │  Series (Raw)    │
  └────────┬─────────┘      └────────┬─────────┘
           │                         │
      ┌────▼─────┐              ┌────▼─────┐
      │ ViT or   │              │ Conv1D + │
      │ CNN      │              │ LSTM     │
      └────┬─────┘              └────┬─────┘
           │                         │
           └──────────┬──────────────┘
                      │
                 ┌────▼────┐
                 │  Fusion │
                 │  Layer  │
                 └────┬────┘
                      │
                 ┌────▼────┐
                 │ Output  │
                 │ Heads   │
                 └─────────┘
```

#### Path A: Vision Model on Echogram Images

This captures **spatial patterns** — fish arches, bottom contour, thermocline bands.

- **Architecture:** Lightweight Vision Transformer (ViT-Tiny) or MobileNetV3-Small
- **Input:** 224×224 RGB echogram frame (or 2-channel: low + high frequency)
- **Context:** Stack 5–10 consecutive echogram frames to give temporal context
- **Pretraining:** Can be initialized from generic image models and fine-tuned on echograms
- **Output:** Feature vector (128–256 dim)

**Why not a larger ViT?** Edge constraints. On-device inference means sub-1B parameter models. A ViT-Tiny (~5M params) runs at 30+ FPS on a modern phone/tablet.

#### Path B: Time-Series Model on Raw Sonar Returns

This captures **fine-grained depth signals** — the exact depth of fish returns, signal strength, frequency response.

- **Architecture:** 1D ConvNet (for local depth patterns) → BiLSTM (for temporal patterns over pings)
- **Input:** Per-ping depth profile (e.g., 500 depth bins × 2 frequencies). Stack 50–200 consecutive pings.
- **Sampling:** Raw sounder at ~5 pings/second. A 30-second window = 150 pings.
- **Output:** Feature vector (128–256 dim)

**Why both paths?** They see different things:
- Echogram images see the **pattern** (arch shape, bottom profile)
- Raw time-series sees the **numbers** (exact depth, amplitude, frequency response)
- Fish species have characteristic frequency responses (different swim bladder resonance)
- Path A is easier to train (lots of generic image pretraining), Path B captures physics

### Fusion Layer

Simple concatenation + 2-layer MLP → joint feature vector (256–512 dim). Can also use cross-attention.

### Output Heads (Multi-Task)

| Head | Task | Output | Loss |
|------|------|--------|------|
| **Species** | Classification | Softmax over N species | Cross-entropy |
| **Abundance** | Ordinal regression | 0–5 classes | Ordinal loss |
| **Bottom type** | Classification | Hard/soft/mud/rock | Cross-entropy |
| **Depth** | Regression | Bounds of fish return | MSE |
| **Confidence** | Self-assessment | 0–1 scalar | Binary cross-entropy |

### On-Device Inference Spec

| Metric | Target | Notes |
|--------|--------|-------|
| **Model size** | < 50 MB (quantized) | INT8 quantization, ~5–15M params |
| **Inference speed** | < 100 ms per analysis window | ~30 second analysis window, real-time is nice-to-have |
| **Memory** | < 200 MB at inference | Shared with ActiveLog app |
| **Framework** | ONNX Runtime / CoreML / TFLite | Cross-platform portable |
| **Frequency** | Analyze every 30s window (real-time) or batch after trip | Real-time for dashboard, batch for training |

---

## 5. Training Loop: How the Analyzer Improves

### Phase 0: Cold Start — Zero Labeled Data

Strategy: **Weak supervision + self-supervised learning**

1. Collect sounder data without labels (easy — it's always on)
2. Use **contrastive learning** (SimCLR-style) on echogram frames to learn representations without labels
3. Use **temporal consistency** — adjacent frames should have similar embeddings
4. Use **frequency response clustering** — pings with similar low/high freq ratios cluster naturally
5. Output: A pretrained backbone that can distinguish "interesting" from "boring" returns

This gives us a functional anomaly detector Day 1: "this return looks different from normal."

### Phase 1: Small Dataset (10–100 Labels)

Strategy: **Few-shot fine-tuning**

1. Freeze echo-ViT backbone, train only fusion + output heads
2. Use label smoothing and data augmentation (time shift, frequency jitter, frame masking)
3. Validation: leave-one-trip-out cross-validation (each trip is a natural split)
4. Expected accuracy: ~60–70% species classification, good abundance estimation

### Phase 2: Medium Dataset (100–1000 Labels)

Strategy: **Full fine-tuning + active learning loop**

1. Unfreeze entire model, fine-tune with lower learning rate
2. Begin **active learning** (see Section 7)
3. The system now suggests pre-labels that Casey corrects (reducing labeling time by 50–70%)
4. Expected accuracy: ~80–85% species classification

### Phase 3: Large Dataset (1000+ Labels)

Strategy: **Multi-model ensemble + distillation**

1. Train multiple architectures (ViT + LSTM, different random seeds)
2. Ensemble predictions
3. Distill ensemble into a single compact model for edge deployment
4. Expected accuracy: ~90%+ species classification (diminishing returns after ~2000 labels)

### Where Does Training Happen?

| Phase | Location | Hardware | Frequency |
|-------|----------|----------|-----------|
| Cold start pretraining | Cloud desktop / rented GPU | A100 / H100 | Once, then re-pretrain yearly |
| Few-shot fine-tuning | Casey's M-series MacBook | Apple Silicon Neural Engine | Per trip (daily) — see below |
| Full fine-tuning | Cloud GPU (only when connected) | A10G / L40S | Weekly/monthly |
| Distillation | Cloud GPU | A100 | After ensemble is good |
| On-device adaptation | iOS/Android phone | Neural Engine / GPU | Continuous (tiny updates) |

### On-Device Fine-Tuning Strategy (Edge AI)

Modern phones have capable neural engines. Apple's ANE can train small models (!) in near-real-time. Strategy:

1. **Collect new labels** on ActiveLog Desktop (asynchronous, post-trip)
2. **Export** a small fine-tuning bundle: new labels + corresponding sounder windows
3. **Run on-device training** using CoreML fine-tuning or ONNX Runtime training API
4. **Update weights in-place** — a few SGD steps, not full epochs
5. **Model drift guard** — monitor validation accuracy on a held-out set of 50 labels. If accuracy drops, flag for cloud retraining.

This means: even without internet, Casey's model improves after every trip, after every labeling session.

---

## 6. Vectorize Strategy: Searching Your Fishing Memory

### The Embedding Hub

Every analysis window (30 seconds of sounder) produces a **multi-modal embedding vector**:

```
embedding = concat(
    vision_embedding(echogram_stack),     # Path A: 256-dim
    timeseries_embedding(sonar_window),    # Path B: 256-dim
    transcript_embedding(transcript_near), # Text: 384-dim (MiniLM)
    camera_embedding(camera_frame),        # Vision: 256-dim (if available)
    env_embedding(temp, tide, depth, ...)  # Numerical: 64-dim
)
```

Total: ~1216-dimensional embedding per window.

### Cloudflare Vectorize Index

Each trip is indexed:

```
Vectorize Index: "activelog-sounder"
Dimension: 1216
Metric: cosine
Entries per trip: ~1440 (12 hours at 30s windows)

Entry schema:
{
  id: "trip_20260718_14:22:00",
  values: [0.23, -0.15, ...],
  metadata: {
    trip_id: "2026-07-18",
    timestamp: "14:22:00",
    depth_bounds: [0, 200],
    species_label: "sockeye_salmon",
    user_confidence: 4,
    has_camera: true,
    region: "Puget Sound"
  }
}
```

### Vector Search Queries

| Query | How It Works |
|-------|--------------|
| "When did we see that big school of sablefish?" | Embed the text query → Vectorize search → return top-K matching windows → show transcript + camera + echogram |
| "Show me all hard-bottom returns at 30-40fm" | Embed a synthetic query or filter by metadata — Vectorize supports metadata filtering natively |
| "Find similar returns to this one" | Take the embedding of a known window → search by cosine similarity |
| "What did I see last time I was at this spot?" | GPS coordinate → filter by region in metadata → show results |

### Local Vector Search (Offline)

When offline, use **usearch** or **FAISS** running locally on the phone/laptop. Cloudflare Vectorize syncs when connectivity returns.

```python
# Offline local index
import faiss
index = faiss.IndexFlatIP(1216)  # Inner product = cosine on normalized vectors
# Or: usearch.index
```

### Search UX

Casey types in natural language:
```
"find the big sockeye school from last Tuesday"
→ "Found 3 matches. The best match is at 14:22 on 2026-07-18, 
   40 fathom depth, estimated 200+ fish, camera confirmed."
→ [Play button] → shows the echogram + transcript + camera frame
```

This is the killer feature. The model doesn't just predict — it **indexes your fishing memory**.

---

## 7. Active Learning: The System Teaches Itself

### The Confidence Cascade

Every analysis window passes through the model and gets a **confidence score** per output head:

```
if confidence > threshold (e.g., 0.95):
    → Auto-accept prediction (no label needed)
elif confidence > mid_threshold (0.70):
    → Flag as "suggested label for Casey" (pre-labeled, just needs correction)
else:
    → Flag as "high-value labeling candidate"
```

### Active Learning Loop

```
1. For each trip, the model generates predictions for every 30s window
2. Windows with low confidence are ranked by "expected information gain"
3. The top-K most valuable windows become "Home Run Candidates"
4. These are presented to Casey: "Next time we're in this area, drop a camera at 40 fathoms between 14:00-15:00"
5. Casey takes action (or not) — the system makes suggestions, not demands
6. When labeled data returns, the model improves specifically on its weakest areas
```

### Information Gain Heuristic

Score each unlabeled window by:
- **Model uncertainty** = highest softmax probability (lower = more uncertain)
- **Embedding novelty** = distance to nearest labeled cluster in embedding space (further = more novel)
- **Label utility** = how many future predictions this label would improve (estimated by density in embedding space)

```
active_learning_score = (1 - max_prob) * embedding_novelty * density_factor
```

### Batch Selection

After each trip, select the top 10–20 windows and suggest camera drops for the next trip. This is the loop:

```
Trip N  →  Model predicts on all windows
         →  Active learning selects 10 most informative windows
         →  Casey gets suggestions: "Drop camera at 43fm, 14:30-15:00"
         →  Trip N+1: Casey drops camera at suggested depth/time
         →  Camera footage + new labels arrive
         →  Model is fine-tuned on this specific failure case
         →  Accuracy at that depth/region improves
```

### Adaptive Thresholds

As the model improves, confidence thresholds automatically adjust:
- Don't keep asking about known patterns (already accurate)
- Focus on novel depths, novel species, novel regions
- If Casey never labels a certain category, deprioritize it

---

## 8. Data Architecture: Storage & Versioning

### Storage Tier Architecture

```
                    ┌─────────────────────┐
                    │   Hot (Phone/SSD)    │
                    │   Current trip only  │
                    │   ~10-100 GB         │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Warm (Home Server) │
                    │   All raw data       │
                    │   ~1-10 TB           │
                    │   Synced from trips  │
                    └──────────┬──────────┘
                               │ (when available)
                    ┌──────────▼──────────┐
                    │   Cold (R2 / Glacier)│
                    │   Archived trips     │
                    │   ~100+ TB scale     │
                    │   Raw video + audio  │
                    └─────────────────────┘
```

### What Goes Where

| Data Type | Hot | Warm | Cold | Notes |
|-----------|-----|------|------|-------|
| Transcript (.alog) | ✅ | ✅ | ✅ | Tiny, keep everywhere |
| Processed sounder | ✅ | ✅ | ✅ | Needed for model |
| Raw sounder pings | ❌ | ✅ | ✅ | Re-process if needed |
| Echogram frames | ✅ (thumbnails) | ✅ (full) | ✅ (full) | Keep for model retraining |
| Camera video | ❌ | ✅ | ✅ | Only on warm/cold |
| Camera keyframes | ✅ (extracted) | ✅ (extracted) | ✅ (extracted) | 1 frame/min from video |
| Embeddings | ✅ | ✅ | ✅ | Vectorize + local FAISS |
| Labels | ✅ | ✅ | ✅ | D1 + local JSON |
| Models | ✅ (current) | ✅ (all versions) | ✅ (all versions) | Version every fine-tune |
| Environmental | ✅ | ✅ | ✅ | Small, keep everywhere |

### Database Choices

#### D1 (Cloudflare / Local SQLite) — Metadata & Labels

```sql
CREATE TABLE trips (
    id TEXT PRIMARY KEY,
    vessel_id TEXT NOT NULL,
    departure_ts TEXT NOT NULL,
    arrival_ts TEXT NOT NULL,
    region TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE analysis_windows (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    start_ts TEXT NOT NULL,
    end_ts TEXT NOT NULL,
    depth_min REAL,
    depth_max REAL,
    species_pred TEXT,
    abundance_pred INTEGER,
    confidence REAL,
    embedding_id TEXT,
    has_camera BOOLEAN DEFAULT 0,
    has_label BOOLEAN DEFAULT 0,
    FOREIGN KEY (trip_id) REFERENCES trips(id)
);

CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    window_id TEXT NOT NULL,
    species TEXT,
    abundance INTEGER,
    user_confidence INTEGER,
    camera_confirmed BOOLEAN DEFAULT 0,
    notes TEXT,
    labeled_at TEXT,
    FOREIGN KEY (window_id) REFERENCES analysis_windows(id)
);

CREATE TABLE camera_drops (
    id TEXT PRIMARY KEY,
    trip_id TEXT NOT NULL,
    start_ts TEXT NOT NULL,
    end_ts TEXT NOT NULL,
    target_depth REAL,
    actual_depth REAL,
    video_path TEXT,
    FOREIGN KEY (trip_id) REFERENCES trips(id)
);
```

#### R2 — Raw & Processed Blobs

```
activelog-data/
  trips/
    2026/
      07-18/
        sounder/raw/       ← Delete after processing
        sounder/processed/  ← Keep for model training
        camera/original/    ← Keep for re-analysis
        camera/keyframes/   ← Keep for Vectorize reference
        models/
          v001.onnx         ← Model version used for this trip
          v002.onnx         ← After post-trip fine-tune
    2026-07-19/
        ...
  models/
    production.onnx         ← Current production model
    v001/                   ← Model version history
    v002/
  embeddings/
    faiss_index.idx         ← Latest FAISS index
    vectorize_snapshot.json.json
```

### Local SQLite (Offline Master)

On the phone/laptop, the **entire metadata and labels database** lives in SQLite. D1 is the cloud replica. Sync works like:

```
Offline: all reads/writes hit local SQLite
When connected: 
  1. Push local changes (new labels, new trips) → D1
  2. Pull cloud changes (model updates, Vectorize results) → local
  3. Resolve conflicts by last-write-wins with trip-level granularity
  4. Sync completed flag set per trip
```

### Data Versioning

Every model run has a **training manifest**:

```json
{
  "model_version": "v004",
  "training_date": "2026-08-01",
  "data_sources": {
    "trips_included": ["2026-07-18", "2026-07-19", "2026-07-22"],
    "label_count": 342,
    "camera_confirmed_labels": 187
  },
  "architecture": "vit-tiny+bilstm-fusion",
  "training_parameters": {
    "epochs": 50,
    "batch_size": 16,
    "learning_rate": 3e-4,
    "augmentation": true
  },
  "metrics": {
    "species_accuracy": 0.87,
    "abundance_mae": 0.42,
    "bottom_type_accuracy": 0.93
  }
}
```

This lets Casey or downstream consumers answer "what model was used for trip X?" and "has this label been used in training?"

---

## 9. The Asynchronous Edge Case: Camera Drop Ingestion

### Scenario Recap

- Trip day: Casey drops a GoPro on an SD card for 1 hour at 40 fathoms (14:00–15:00)
- Then another drop at 60 fathoms (15:30–16:30)
- Sounder + transcript are recording the whole time
- Camera footage is on a separate SD card, no live connection to ActiveLog

### Ingestion Pipeline

#### Step 1: Associate Camera Drop to Trip

When Casey returns, the SD card is plugged in. ActiveLog detects:
- Camera filesystem: DCIM/100GOPRO/GH012345.MP4 (created 14:00)
- Casey enters: "Drop 1: 40 fathoms, 14:00-15:00. Drop 2: 60 fathoms, 15:30-16:30"
- ActiveLog matches these against the trip's transcript for the "dropping camera" utterance

#### Step 2: Camera-Sounder Depth Alignment

The sounder sees the camera as a **descending object**. This is a free synchronization anchor:

1. Find the sounder signature of a descending object (strong return starting at surface, moving down)
2. Match descent speed ≈ drop line speed (typically 1–2 m/s)
3. Calculate **exact time of camera deployment** from sounder data (typically within ±1–2 seconds of Casey's utterance)
4. This gives us precise temporal alignment

#### Step 3: Video Segmentation

For each camera drop:
1. Extract one frame every 1–5 seconds
2. Map each frame to the sounder depth at that moment:
   - At T=14:00, camera is at surface (0 ft)
   - At T=14:02, camera is at ~40 ft (descending at 20 ft/min)
   - At T=14:04, camera is at ~80 ft
   - At T=14:10, camera reaches 40 fathoms (240 ft)
   - At T=14:10 to 15:00, camera is at ~40 fathoms
3. Assign each frame a **sounder depth column** from the same timestamp

#### Step 4: Generate Training Triplets

For each synchronized time window:

```
[Frame T=14:22:10] ↔ [Sounder column at T=14:22:10] ↔ [Transcript near T=14:22]
```

These triplets become labeled data:
- If camera shows fish → strong positive label
- If camera shows empty water → strong negative label
- If camera shows different species than sounder prediction → correction label

#### Step 5: Cross-Drop Integration

If drop 1 (40fm) shows sockeye and drop 2 (60fm) shows sablefish:
- The model learns: **depth is a discriminative feature** for species
- The embedding space clusters: same depth, similar returns, re-labelable automatically
- This is the power of multi-drop trips — they provide **depth-contrastive pairs** naturally

### Advanced: Camera Auto-Analysis

Once the model is decent, the camera footage can be **automatically analyzed** as ground truth:

1. Run a lightweight fish detection model (YOLO-NAS) on camera frames
2. Count fish per frame, estimate size
3. Cross-reference with sounder: "the model said 50 fish at 40fm, camera detects 47 fish — close enough!"
4. This creates **synthetic labels** at scale (though they should be flagged as "unverified auto-label")

### The Self-Improving Flywheel

```
Camera Drop → Frame Extraction → Auto-analyze → Synthetic Labels → Model Training → 
    Better Predictions → Better Active Learning Suggestions → More Targeted Drops → 
        Better Labels → Better Model → ...
```

---

## 10. Deployment Architecture

### On the Boat (Offline, Real-Time)

```
┌────────────────────────────────────────────────────┐
│              Casey's Phone / Tablet                │
│                                                    │
│  ┌─────────────┐  ┌─────────────┐  ┌────────────┐│
│  │  ActiveLog   │  │  Sounder    │  │  Camera    ││
│  │  App        │  │  Analyzer   │  │  App       ││
│  │  (UI + TTS) │  │  ONNX/CoreML│  │  (Viewer)  ││
│  └──────┬──────┘  └──────┬──────┘  └─────┬──────┘│
│         │                │               │        │
│         └────────────────┼───────────────┘        │
│                          │                        │
│                    ┌─────▼──────┐                 │
│                    │   Local    │                 │
│                    │  SQLite    │                 │
│                    │  FAISS     │                 │
│                    └────────────┘                 │
└────────────────────────────────────────────────────┘
                            │
                    (Sync when online)
                            │
┌───────────────────────────▼─────────────────────────┐
│            Home Server (Mac Mini / NUC)             │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌────────┐  ┌──────┐ │
│  │ Sync     │  │ Desktop  │  │ Label  │  │ Model│ │
│  │ Engine   │  │ Server   │  │ Store  │  │Train │ │
│  └──────────┘  └──────────┘  └────────┘  └──────┘ │
└────────────────────┬───────────────────────────────┘
                     │
              (Cloudflare tunnel / API sync)
                     │
┌────────────────────▼───────────────────────────────┐
│             Cloudflare (Cloud)                      │
│                                                     │
│  ┌──────┐  ┌──────┐  ┌──────────┐  ┌───────────┐  │
│  │ R2   │  │ D1   │  │Vectorize │  │ Workers AI │  │
│  │Blobs │  │Meta  │  │ Index    │  │ Inference  │  │
│  └──────┘  └──────┘  └──────────┘  └───────────┘  │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │  Workers: Sync API, Inference API, Search    │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

---

## 11. Metrics: How Do We Know It's Working?

### Scientific Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Species classification accuracy | >85% (Phase 2), >90% (Phase 3) | Hold-out test set from camera-confirmed labels |
| Abundance ordinal accuracy | >80% correct within ±1 class | Confusion matrix on camera-verified counts |
| Bottom type accuracy | >90% | Verified against camera + manual logs |
| Depth prediction error | <2 fathoms | Compare predicted vs. actual fish depth from camera |
| Embedding retrieval precision@10 | >80% | "Find similar returns" — human judges top-10 relevance |
| Active learning efficiency | 2x faster accuracy gain vs. random sampling | Compare active learning vs. random label selection curves |

### Fisherman-Utility Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Time to label a trip | <30 min for 8-hour trip | ActiveLog UI telemetry |
| Label suggestions accepted | >50% of auto-labels accepted by Casey | Label correction rate |
| Search hit rate | Casey finds what he's looking for on first search | Search UX telemetry |
| Model improvement per trip | Measurable accuracy gain after each sync | Trip-by-trip accuracy on new labels |

### Edge Metrics

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Phone inference time | <100 ms per window | ONNX Runtime benchmark |
| Phone battery impact | <5% per 12-hour trip | Before/after battery test |
| Sync time (full trip) | <5 min on marina WiFi | Sync timing telemetry |
| R2 storage per trip | <10 GB (excluding raw camera) | Bucket size monitoring |

---

## 12. Roadmap: Phased Delivery

### Phase 0: Foundation (Now — Next 2 Months)
- [ ] Data collection pipeline: capture all 4 streams with rough timestamps
- [ ] File system convention (see Section 2)
- [ ] Pre-trip clock calibration workflow
- [ ] Sounder raw → echogram frame converter
- [ ] Local SQLite schema + ingestion script

### Phase 1: Labeling + Search (Month 3–4)
- [ ] ActiveLog Desktop labeling interface (timeline)
- [ ] Embedding pipeline (MiniLM for transcript, simple echogram CNN)
- [ ] Local FAISS index for search
- [ ] Vectorize index sync
- [ ] Natural language search: "find that big sockeye school"

### Phase 2: Sounder Analyzer v1 (Month 5–7)
- [ ] Vision Path (ViT-Tiny on echograms)
- [ ] Time-Series Path (Conv1D + BiLSTM on raw pings)
- [ ] Fusion model training
- [ ] ONNX export + CoreML conversion
- [ ] On-device inference in ActiveLog app
- [ ] Active learning loop (first iteration)

### Phase 3: Active Learning + Camera Integration (Month 8–10)
- [ ] Camera ingestion pipeline (SD card → synchronized frames)
- [ ] Camera auto-analysis (YOLO-NAS fish detection)
- [ ] Active learning: camera drop suggestions
- [ ] Synthetic label generation from camera
- [ ] On-device fine-tuning

### Phase 4: Maturation (Month 11+)
- [ ] Multi-trip model improvement tracking
- [ ] Ensemble + distillation for production model
- [ ] Cross-vessel transfer learning (multiple boats)
- [ ] Web dashboard for trip history + model stats
- [ ] Community model sharing (opt-in)

---

## 13. Open Questions & Risks

### Technical Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Sounder data format is proprietary | Can't parse raw pings | Start with echogram images (Path A only). Negotiate NMEA access for Path B. |
| Camera footage quality too low for species ID | Camera useless as ground truth | Use motion-based detection (fish vs. no fish). Partner with underwater camera experts. |
| Model doesn't generalize across bodies of water | Works in Puget Sound, fails in Bering Sea | Collect data from multiple regions. Add region embedding. Transfer learning. |
| Active learning suggestions ignored by fisherman | No improvement loop | Make suggestions valuable (show predicted catch rate). Gamify? |
| On-device fine-tuning kills phone battery | Nobody does it | Run only when plugged in. Show "model improving" badge to motivate. |

### Data Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Slow label accumulation (<1 label/trip) | Never reach critical mass | Make labeling fast (<30 min). Auto-label camera. Gamify with "catch prediction" feature. |
| Label quality inconsistent | Noisy training data | User confidence score per label. Train on high-confidence subset. |
| Temporal label alignment wrong | Incorrect training pairs | Event-bound anchors. Drift detection in post-processing. Allow manual correction in UI. |
| Too much data too fast | Storage costs explode | Smart retention (camera keyframes only). Warm-tier pruning after model saturation. |

### Business Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Casey stops using ActiveLog | Whole pipeline dies | Make it addictive. Show value early. Search is the hook. |
| Model quality doesn't improve fast enough | "Why isn't this working?" under 100 labels | Set expectations: show progress curves. "This will be useful by trip 20." |
| Competitor builds this first | Lost competitive advantage | Publish nothing until Phase 2. Build community around the approach. |

---

## 14. The Long Game: From Sounder to Sonar

Once the pipeline is proven on a single-frequency sounder:
- Add **sidescan sonar** (wider coverage, better habitat mapping)
- Add **downscan imaging** (photo-quality sonar returns)
- Add **water column data** (temperature profile, oxygen levels)
- Add **trawl data** (direct species verification at depth)

The architecture is designed to handle new input modalities by adding embedding paths and fusing at the same layer.

### Beyond Fishing

This pipeline generalizes to any **human-guided sensor interpretation** task:
- Mining (interpreting ground-penetrating radar)
- Medical (ultrasound interpretation guided by expert observations)
- Oceanography (ROV data + scientist narration)
- Search and rescue (sonar + operator commentary)

The boat is the reference implementation. The architecture is the product.

---

## Appendix A: Key Technologies

| Component | Recommended Choice | Alternative |
|-----------|-------------------|-------------|
| Vision model | ViT-Tiny (custom pretrain on echograms) | MobileNetV3, EfficientNet-lite |
| Time-series model | Conv1D + BiLSTM | TCN, InceptionTime |
| Text embedding | MiniLM-L6-v2 (384-dim) | BERT-tiny, DistilBERT |
| Fusion | Concat + MLP | Cross-attention transformer |
| On-device inference | ONNX Runtime | CoreML, TFLite, ExecuTorch |
| On-device training | CoreML fine-tuning / ONNX Training API | PyTorch Mobile |
| Local vector search | FAISS (IndexFlatIP) | usearch, pgvector (offline: no) |
| Cloud vector search | Cloudflare Vectorize | Pinecone, Weaviate |
| Offline DB | SQLite (app-local) | DuckDB |
| Cloud DB | Cloudflare D1 | Turso, PlanetScale |
| Blob storage | Cloudflare R2 | AWS S3, Backblaze B2 |
| Model format | ONNX (portable) | CoreML (iOS), TFLite (Android) |
| Training (cloud) | PyTorch + HuggingFace | JAX, Keras |

## Appendix B: Minimum Viable Pipeline (MVP)

What can we build **today** with zero retraining?

1. **Collect all 4 streams** with rough timestamps (+15s accuracy is fine for MVP)
2. **Manual synchronization** — Casey writes down "camera at 40fm at 14:05" in a notebook
3. **Manual labeling** — After trip, Casey reviews camera footage + sounder screenshots and writes species notes. (Yes, manual. Pain builds motivation for automation.)
4. **Store in file system** — the directory structure in Section 2
5. **Basic echo-ViT pretraining** on sounder echogram frames (self-supervised, no labels needed)
6. **Simple search** — embed everything, run FAISS, type "sockeye" and find similar-looking returns

That's it. That's the seed. Everything else grows from having labeled triplets.

---

*"The boat is edge AI's reference implementation. Every problem you solve on a 40-foot fishing vessel is one you don't have to solve in a data center."*

— End of Brainstorm —
