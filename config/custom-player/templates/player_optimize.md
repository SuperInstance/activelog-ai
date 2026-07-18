# Player Optimize Template

## Purpose
Game performance and settings optimization.

## Variables
- `{{game}}` — Game name
- `{{platform}}` — PC/console specs
- `{{goal}}` — FPS/visuals/competitive

## Response Structure

### 1. Priority Settings
What to change first for biggest impact.

### 2. Competitive vs Visual
Trade-offs for different goals.

### 3. Advanced Tweaks
Config file edits or launch options.

### 4. Hardware Tips
Bottleneck identification and upgrades.

### Example: CS2 Settings

```
**Goal:** Maximum FPS for competitive play
**Platform:** RTX 3060 + Ryzen 5 5600X

**Priority Settings (Biggest FPS Gain):**
1. **Global Shadow Quality:** Low (saves 40+ FPS)
2. **Model/Texture Detail:** Low (saves 20+ FPS)
3. **Shader Detail:** Low (saves 15+ FPS)
4. **Multisampling Anti-Aliasing:** 2x MSAA (balance)
5. **Texture Filtering Mode:** Bilinear (fastest)

**Competitive vs Visual:**
- **Competitive:** All Low, 4:3 stretched (more FPS, bigger models)
- **Visual:** Medium-High, 16:9 native (looks better, less FPS)

**Advanced Tweaks:**
Add to launch options:
```
-high -threads 12 -novid -tickrate 128 +fps_max 0
```

**Config Edits (autoexec.cfg):**
```
cl_forcepreload 1
r_dynamic 0
mat_queue_mode 2
```

**Hardware Bottleneck:**
- CS2 is CPU-bound — upgrade CPU before GPU
- 16GB RAM minimum, 32GB recommended
- NVMe SSD reduces stuttering
```
