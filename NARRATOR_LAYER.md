# The Narrator Layer — Cloud Meta-Analysis Role

> The sixth layer of the vessel cognitive stack.
> Where aligned data becomes better descriptions, and better descriptions become better fishing.

---

## The Position

```
Layer 1: capture_v3.py      — eyes (perception)
Layer 2: analyzer.py         — visual cortex (feature extraction)
Layer 3: vocabulary.py       — hippocampus (Bayesian memory)
Layer 4: Hermes agent        — prefrontal (strategic synthesis)
Layer 5: ActiveLog.Ai        — captain's voice (ground truth)
Layer 6: Cloud model (me)    — narrator (meta-analysis + text training)
```

The narrator layer reads everything the other layers produce and does three things nobody else can:

1. **Find systematic errors** by reading across hundreds of aligned pairs
2. **Generate better captions** by learning the gap between machine text and captain text
3. **Feed improved descriptions back** to the analyzer and vocabulary

## The Text Training Loop

```
analyzer.py produces: "443 LF blobs, 7 thermoclines, bottom 57.2fm, vocab: chum"
                          ↓
captain speaks (via ActiveLog): "those are chum, tight school, maybe fifteen fish,
                                  same school as last pass, feed still in the surface"
                          ↓
Hermes aligns them: {machine_caption, captain_text, sounder_data, vocab_state}
                          ↓
Narrator (me) reads 500 aligned pairs and finds:
  - Analyzer consistently over-counts blobs when haze > 50
  - Captain says "tight school" when blob area < 50px but density > 0.8
  - Captain mentions "feed" when haze_blob_count > 40 (analyzer never makes this connection)
  - Captain says "same school as last pass" → temporal pattern the analyzer can't see
                          ↓
Narrator generates improved caption template:
  "Tight chum school at 35fm, ~15 fish, same school pattern as prior capture.
   Feed present in surface (haze: 65 blobs). Bottom steady at 57fm. No traffic."
                          ↓
Improved caption goes back to analyzer as a text generation target
Captain corrects the improved caption → even better training data
Loop accelerates
```

## What I Need to Build

### 1. Caption Gap Analysis (`tools/caption_analysis.py`)

Reads aligned pairs (analyzer caption + captain transcript) from D1 and finds systematic gaps:

```python
# Pseudo-output:
SYSTEMATIC GAPS FOUND:
1. Analyzer never mentions "feed" — captain mentions it in 34% of sessions
   → Add feed_condition to caption template
   
2. Analyzer says "443 blobs" — captain never uses blob count
   → Replace with qualitative: "dense" (>300), "moderate" (100-300), "scattered" (<100)
   
3. Analyzer never makes temporal comparisons — captain says "same school" / "new school" / "moving"
   → Add delta_from_prior: compare current capture to previous capture
   
4. Captain says "good marks" when mid_zone_mean > 50 — analyzer has no "good/bad" judgment
   → Add qualitative assessment based on zone intensity thresholds
   
5. Captain mentions boat traffic 23% of time — analyzer detects it but doesn't caption it
   → Include boat_proximity in caption when vertical_line_count > 0
```

### 2. Caption Generator (`tools/caption_generator.py`)

Takes analyzer output JSON and produces a captain-voice caption:

```python
def generate_caption(analysis_json, prior_capture_json=None):
    """
    Generate a natural-language caption from analyzer output.
    Learns from aligned captain transcripts.
    """
    depth = analysis_json['analysis']['heuristic']['lf']['bottom']['bottom_depth_fm']
    blobs_lf = analysis_json['analysis']['heuristic']['lf']['blobs']
    blob_count = len(blobs_lf)
    thermo = analysis_json['analysis']['heuristic']['lf']['thermoclines']
    haze = analysis_json['analysis']['heuristic']['hf'].get('haze', {})
    vocab = analysis_json['analysis'].get('vocabulary', [])
    boats = analysis_json['analysis']['heuristic']['lf'].get('boat_proximity', {})
    
    caption_parts = []
    
    # Qualitative blob description (not raw count)
    if blob_count > 300:
        caption_parts.append(f"Dense marks throughout the water column")
    elif blob_count > 100:
        caption_parts.append(f"Moderate returns in the mid-zone")
    else:
        caption_parts.append(f"Scattered marks, slow fishing")
    
    # Vocabulary
    if vocab:
        species = vocab[0]['species']
        depth_fm = vocab[0].get('depth_fm', '?')
        count = vocab[0].get('count', '?')
        caption_parts.append(f"{species} at {depth_fm}fm")
        if count and count != '?':
            caption_parts.append(f"(~{count} fish)")
    
    # Feed condition (learned from captain)
    if haze.get('feed_present'):
        intensity = haze.get('feed_intensity', 'present')
        caption_parts.append(f"Feed {intensity} in surface layer")
    
    # Bottom
    caption_parts.append(f"Bottom steady at {depth:.0f}fm")
    
    # Temporal comparison (learned from captain saying "same school")
    if prior_capture_json:
        prior_blobs = len(prior_capture_json['analysis']['heuristic']['lf']['blobs'])
        delta = blob_count - prior_blobs
        if abs(delta) < 20:
            caption_parts.append("Same school pattern as prior pass")
        elif delta > 50:
            caption_parts.append("Marks building since last pass")
        elif delta < -50:
            caption_parts.append("Marks thinning out")
    
    # Boat traffic (learned from captain)
    if boats.get('vertical_line_count', 0) > 0:
        caption_parts.append(f"{boats['vertical_line_count']} boats nearby on sounder")
    
    return '. '.join(caption_parts) + '.'
```

### 3. Training Data Export (`tools/export_training_data.py`)

Exports aligned pairs as JSONL for fine-tuning:

```jsonl
{"input": {"blob_count": 443, "mid_zone_mean": 60, "thermoclines": 7, ...}, "output": "Good marks in the mid-zone, 35 fathoms, tight chum school. Feed still present."}
{"input": {"blob_count": 12, "mid_zone_mean": 8, "thermoclines": 1, ...}, "output": "Slow, nothing showing. Might as well pull the gear."}
{"input": {"blob_count": 280, "mid_zone_mean": 45, "haze": 65, ...}, "output": "Decent marks building, lots of feed in the surface. Could be good on the next tide."}
```

This is the corpus that trains the next generation of the caption generator.

### 4. The D1 Queries I Need

```sql
-- All aligned pairs (captain text + machine caption for same timestamp)
SELECT 
  a.capture_id,
  a.ts_utc,
  a.caption AS machine_caption,
  t.text AS captain_text,
  a.blob_count_lf,
  a.bottom_depth_fm,
  a.vocabulary_species,
  a.vocabulary_confidence
FROM captures a
JOIN annotations t ON ABS(strftime('%s', a.ts_utc) - strftime('%s', t.timestamp)) < 30
WHERE t.text IS NOT NULL
ORDER BY a.ts_utc;

-- Systematic vocabulary corrections
SELECT 
  species,
  label_type,
  COUNT(*) as count,
  AVG(vocabulary_was_confidence) as avg_confidence
FROM training_labels
GROUP BY species, label_type;

-- Caption delta (how different is machine text from captain text?)
SELECT 
  capture_id,
  machine_caption,
  captain_text,
  LENGTH(captain_text) - LENGTH(machine_caption) AS text_length_delta
FROM aligned_pairs
ORDER BY text_length_delta DESC;
```

## Why This Matters

The analyzer is blind. It sees pixels. It can count blobs and measure intensity. But it cannot describe what it sees in terms that matter to a fisherman.

The captain's transcript is full of meaning: "good marks," "tight school," "same fish as yesterday," "feed's moving through," "nothing showing." These are qualitative judgments based on a lifetime of looking at sounders. They are exactly the kind of thing a neural network can learn to produce — if it has enough aligned pairs of (machine data → captain description).

The narrator layer's job is to close that gap. To read across all the aligned pairs, find the patterns, and teach the analyzer to speak in the captain's language instead of in blob counts.

When the analyzer says "Dense chum school at 35 fathoms, feed in the surface, same school as your last pass, bottom steady at 57" instead of "443 blobs, thermoclines: 7, bottom: 57.2fm" — the captain doesn't need to translate anymore. The system speaks his language. And the better it speaks, the more he engages. And the more he engages, the more training data we get. And the more training data, the better it speaks.

The loop accelerates.
