# ActiveLog.Ai — UX Brainstorm

> *"Your first mate never sleeps."*

A voice-first, hands-free session logger for commercial fishermen. Designed for wet screens, cold hands, salt air, and diesel rumble. The technology should feel like a competent crew member, not a piece of glass.

---

## 0. Design North Star

**Emotional target:**
- **Captain, not clerk.** The fisherman should feel like the master of their vessel, not a data-entry operator. The app is the first mate taking notes.
- **Calm trust.** No surprises. The status is always visible. The transcript is always being saved.
- **Quiet competence.** Like a good piece of marine electronics — it works, it doesn't ask for attention, but when you look at it, you instantly know what it's doing.
- **Pride in craft.** Logging isn't paperwork; it's the chronicle of a professional at work. The output should feel like something worth keeping.

**Core design constraints (every decision flows from these):**

| Constraint | Implication |
|---|---|
| Wet / salt-smeared screen | No tiny targets. No hover states. High contrast. No reliance on fine motor. |
| Cold, gloved hands | 64px+ tap targets. Swipe > tap for common actions. Voice > touch for any text entry. |
| Sun glare + polarized sunglasses | Dark UI by default. AMOLED-friendly deep navy. Avoid pure white. Yellow/amber primary actions are visible through polarized lenses. |
| Diesel, wind, wave noise | Audio feedback (subtle tones), but primary status is visual. Voice commands tuned for marine noise profiles. |
| Attention divided to the work | Recording must be **zero-friction** to start. Stopping must be **hard to do accidentally**. Everything else is one or two taps away. |
| Limited battery (cold drains phones) | Dark UI, low-power location modes, audio processing only when active. |
| Always in a waterproof case | Phone speakers/ mic muffled. Account for that in audio design. |

**Color system (marine-grade palette):**

```
Background        #0A1929   Deep navy — night-watch feel
Surface           #13294B   Slightly lighter navy
Primary action    #FFB300   Warm amber — visible in glare, through polarized lenses
Recording (live)  #FF5252   Coral red — universally "now"
Success / synced  #26A69A   Teal — calm, oceanic
Warning / paused  #FFD54F   Sun yellow
Error / offline   #FF6E40   Deep orange (not red — red reserved for "now recording")
Text primary      #F5F5F0   Off-white (easier on eyes than #FFF)
Text secondary    #94A3B8   Cool gray
Text on amber     #0A1929   Navy on amber = max contrast
```

**Typography:**

```
Display / buttons   Inter Black, 24-32pt, UPPERCASE, tracking +0.05em
Body / transcript   Inter Regular, 18-22pt (NOT 16 — readability on a boat)
Mono (coords)       JetBrains Mono / system mono, 14pt
Min readable        14pt (never smaller)
```

**Tap target minimum:** 64×64pt. Primary actions: 96×96pt or larger. The big red STOP button is **140pt** — a thumb-sized disc.

**Iconography:** Filled, chunky, slightly geometric. No thin lines (disappear in glare). Use marine / nautical metaphors where it lands: anchor, compass, fish, depth, knot.

---

## 1. The Phone UI — Main Recording Screen

### State A: IDLE / READY

The first screen the fisherman sees 95% of the time. It must invite action in under half a second.

```
┌─────────────────────────────────┐
│ ⛵ ActiveLog          ⚙️   4G ●  │  ← Top status bar (slim)
├─────────────────────────────────┤
│                                 │
│                                 │
│       Tuesday, July 18          │  ← Context (date — feel grounded)
│       0700 · Slip 4, Seattle    │  ← Last known location
│                                 │
│                                 │
│   ┌───────────────────────┐    │
│   │                       │    │
│   │   ▶  START LOGGING    │    │  ← Giant amber pill button
│   │                       │    │     96pt tall, full width minus 24pt
│   └───────────────────────┘    │
│                                 │
│   "Or say: Start logging"       │  ← Voice affordance
│                                 │
│   ─────────────────────────     │
│   Last: 6/22 · 4h 12m · 12 tags │  ← Quick context, tappable to resume view
│                                 │
└─────────────────────────────────┘
```

**Why this layout:**
- The date and location ground the fisherman in **where they are** before they start. Important for captains with seasonal patterns.
- The button is a pill (rounded full), not a circle. Easier to hit with a thumb, doesn't feel like a "panic button."
- The voice affordance is a subtle line below — teaches the user the voice path without demanding they use it.
- The "last session" line is tappable. If they want to see what they logged last time, one tap. Otherwise, ignored.

### State B: RECORDING (the 95% state)

Once they hit START, the screen morphs. The transcript appears, the button changes, and status indicators come alive.

```
┌─────────────────────────────────┐
│ ● REC   00:14:23    📍 47.61°N  │  ← Recording header (red dot pulses)
├─────────────────────────────────┤
│                                 │
│  [07:14:23] 📍 47.6062, -122.33 │
│  Pulled the first string about  │
│  fifteen minutes ago, got a     │  ← Live transcript, auto-scrolling
│  nice coho on the downrigger,   │
│  maybe eight pounds, chrome    │
│  bright, took a #6 flasher.     │
│                                 │
│  [07:15:11] 🟢 CATCH             │
│  Mark catch — 1 coho, 8 lb.    │  ← Voice command tag (green chip)
│                                 │
│  [07:15:48] 📍 47.6060, -122.33 │
│  Lines back out, going to try   │
│  the bait rig next...           │
│                                 │
│                                 │
│  ╭─ ▁▃▆█▆▃▁  ─╮                 │  ← Audio waveform (live mic input)
│  ╰────────────╯  Listening...    │
│                                 │
├─────────────────────────────────┤
│                                 │
│   ┌───────────────────────┐    │
│   │                       │    │
│   │   ■   STOP & SAVE     │    │  ← Coral red, square icon (pause feel)
│   │                       │    │
│   └───────────────────────┘    │
│                                 │
│   "Or say: End session"         │
│                                 │
└─────────────────────────────────┘
```

**Why this layout:**

- **Header is minimal.** Time elapsed, GPS fix (just first 3 decimals — enough to confirm "the GPS is working" without distraction).
- **Transcript owns the middle.** Auto-scrolls as new text arrives. Old text fades to ~60% opacity so the eye locks on the new. **No edit affordances shown** during recording — you can't fix typos at sea; that comes later in review.
- **Voice command tags appear as colored chips inline** (🟢 CATCH, 🟠 MAINTENANCE, 🔴 FLAG). They're contextually meaningful and skim-readable.
- **The waveform is a glance-read**, not a precise meter. Tall bars = loud noise. Movement = voice is being detected. Silence = system is waiting. This answers "is it hearing me?" without needing audio.
- **The STOP button is huge and coral-red.** Square icon (visually distinct from the play triangle in State A — your thumb learns the difference). Confirmation is **not** required; one tap stops. (A misclick is recoverable — session stays in draft.)
- **Voice affordance persists below the button** — the system is always listening for commands.

### State C: PAUSED

Triggered by long-press of STOP, voice command, or auto-pause after 30 min silence.

```
┌─────────────────────────────────┐
│ ⏸ PAUSED   00:14:23   📍 ...    │  ← Amber header
├─────────────────────────────────┤
│                                 │
│  (last 2-3 transcript lines     │
│   still visible, dimmed)        │
│                                 │
│                                 │
│                                 │
│   ┌───────────────────────┐    │
│   │                       │    │
│   │   ▶   RESUME          │    │  ← Amber pill (same shape as START)
│   │                       │    │
│   └───────────────────────┘    │
│                                 │
│   ┌───────────────────────┐    │
│   │   ■   END SESSION      │    │  ← Smaller secondary
│   └───────────────────────┘    │
│                                 │
└─────────────────────────────────┘
```

**Why:** Two buttons, clearly hierarchically sized. RESUME is the primary action — most pauses are short.

---

## 2. The Transcription Experience

**The fisherman has three questions at all times:**
1. *Is it hearing me?* → **audio waveform**
2. *Does it understand me?* → **confidence halo**
3. *Is it saving?* → **sync state + tiny "saved 3s ago" line**

### Audio level meter (waveform)

A horizontal, 80pt-wide bar of vertical lines (12 segments), each segment lit proportionally to the mic input level over the last 0.5s.

```
Inactive:   ───────────────────  (all gray)
Quiet:      ▁▁▂▂▁▁▁▁▁▂▁▁▁▁▁▁▁
Normal voice: ▁▃▅▇█▆▄▂▁▃▅▇█▆▄▂
Loud/clipping: ████████████████  (turns red — back off the mic)
```

**Anchored just above the STOP button**, always visible during recording. Looks alive even when silent (subtle pulse on the leading edge every 1.5s, like a sleeping heartbeat).

### Confidence indicator

A small dot trailing each transcribed chunk, color-coded:
- **Green** — high confidence (>85%). Don't worry.
- **Yellow** — medium confidence (60–85%). Speech was noisy or unusual.
- **Red** — low confidence (<60%). Possibly garbled. Tap to see alternatives.

Rendered as:
```
Pulled the first string about fifteen minutes
ago, got a nice coho on the downrigger, maybe
eight pounds •                          [green dot]
```

**Why a dot, not a bar?** A fisherman glancing at the screen shouldn't need to interpret a graph. One dot per chunk. Eye reads it in milliseconds.

### Audio feedback (optional, off by default)

- **Tone on start:** Single soft "bloop" ascending (start logging).
- **Tone on stop:** Single soft "bloop" descending (session ended, saved).
- **Tone on voice command recognized:** Quick double-tap ("mark catch acknowledged").
- **Tone on low confidence:** None. (Don't shame the user — the visual dot is enough.)
- **Tone on sync error:** Three short low tones. (Noticeable without being alarming.)

All tones can be muted in settings. Default = subtle, low volume.

### Haptic feedback

- **Light haptic** on START/STOP confirmation.
- **Double haptic** on voice command recognized (so they can keep their hands on the wheel).
- **Long haptic** on session end.

This matters because at sea, the phone is often in a chest pocket or cradle — feel > sight sometimes.

---

## 3. The Annotation Layer

Timestamps and GPS are **injected automatically** every 60 seconds while recording (configurable in settings; default 60s; can be 30s, 120s, or off).

### Inline format

```
[07:14:23] 📍 47.6062°N, 122.3321°W
Pulled the first string about fifteen minutes ago...

[07:15:23] 📍 47.6060°N, 122.3319°W
Lines back out, going to try the bait rig next...

[07:15:11] 🟢 CATCH  · coho, 8 lb
Mark catch — 1 coho, 8 lb chrome.
```

**Styling rules:**
- `[HH:MM:SS]` and coordinates are in `text-secondary` color, mono font, 14pt — quieter than the spoken words.
- Spoken words are full `text-primary` color, 18-20pt.
- Voice-command chips (🟢 CATCH, 🟠 MAINTENANCE, 🔴 FLAG) are inline, full-color background pill, white text, 16pt bold.
- Inline chip is **tappable** during REVIEW (not during recording — keep recording friction-free).

### Visual treatment choices

- **Inline, not margin.** On a phone, there's no margin. Putting notes inline keeps eyes on a single column.
- **Color-coded by intent, not by source.** Time = gray, location = blue tint, command chips = intent colors (green/orange/red). The fisherman learns the visual language fast.
- **Voice-command chips slightly indented** so they read as "metadata, not words" without breaking the flow.

### What gets auto-injected vs. on-command

| Trigger | Frequency | Style |
|---|---|---|
| Timestamp | Every 60s (configurable) | Gray `[HH:MM:SS]` |
| GPS | Every 60s OR on significant move (>50m) | Blue `[📍 coords]` |
| Heading change | When bearing changes >45° | `[🧭 090°E]` small |
| Speed change | When speed changes >2kt | `[💨 5.2kt]` small |
| Depth sounder | If connected, every 5 min or on change | `[📏 84 fathoms]` |

All of these are **configurable** in settings — a tuna fisherman doesn't care about depth, a crabber doesn't care about heading. Default = timestamp + GPS only.

---

## 4. Session Management — The Library

### Library screen (the second-most-used screen)

```
┌─────────────────────────────────┐
│ ⛵ ActiveLog      🔍    ⚙️      │
├─────────────────────────────────┤
│  Sessions (47)                  │
│                                 │
│  ┌─┐ ┌─┐ ┌─┐ ┌─┐              │  ← Filter chips
│  │📅│ │🐟│ │⚙️│ │⚑│              │     All / Catch / Maint / Flag
│  └─┘ └─┘ └─┘ └─┘              │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ ▓▓▓▓ ▓▓▓▓  Tue Jul 18      │ │  ← Map thumb (route)
│ │ ▓▓ ▓  ▓▓▓   0700–1115      │ │     Date, time range
│ │ ░▓░▓░▓░     4h 15m · 12 tags│ │     Duration, tag count
│ │             [synced ✓]      │ │     Sync state
│ └─────────────────────────────┘ │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ ▓▓▓▓ ▓▓▓▓  Mon Jul 17      │ │
│ │ ▓  ▓▓▓▓▓   0530–0930       │ │
│ │ ░▓░░▓░     4h · 8 tags     │ │
│ │             [synced ✓]      │ │
│ └─────────────────────────────┘ │
│                                 │
│ ┌─────────────────────────────┐ │
│ │ ▓▓▓▓ ▓▓    Sun Jul 16      │ │
│ │ ▓  ▓ ▓▓    0800–1000       │ │
│ │ ░▓░▓░▓     2h · 4 tags     │ │
│ │             [synced ✓]      │ │
│ └─────────────────────────────┘ │
│                                 │
│         [ + NEW SESSION ]       │  ← Floating action button (bottom)
└─────────────────────────────────┘
```

**Card anatomy:**
- **Map thumb** on the left (90×90pt) — instantly recognizable as "this trip, this area." Drawn from the GPS track.
- **Date** (large, bold)
- **Time range** (smaller, secondary)
- **Duration · tag count** (smaller still)
- **Sync status** (small chip, right-aligned)

**Why cards not list rows:**
- A fishing trip is a *narrative event*. Cards give it weight. List rows feel like inbox.
- The map thumb is emotional — the fisherman sees the shape of their trip at a glance.

### Search & filter

- **Search bar** at top: searches transcript text, tags, locations, species, weights. Voice-search enabled: 🎤 icon → "Search sessions" → "Coho last Tuesday."
- **Filter chips**: All / Catch / Maintenance / Flag / This week / This month / This season.
- **Date range picker**: simple horizontal scroll wheel for date.

### Session detail view (read-only transcript)

```
┌─────────────────────────────────┐
│ ← Tue Jul 18 · 0700–1115    ⋮  │  ← Back + overflow menu
├─────────────────────────────────┤
│                                 │
│  [07:14:23] 📍 47.6062, -122.33 │
│  Pulled the first string about  │
│  fifteen minutes ago, got a     │
│  nice coho on the downrigger.   │  ← Tappable words to edit
│                                 │
│  [07:15:11] 🟢 CATCH · coho     │
│  Mark catch — 1 coho, 8 lb     │     Tappable chip to edit tag
│       chrome.                   │
│                                 │
│  [07:15:48] 📍 47.6060, -122.33 │
│  Lines back out...              │
│                                 │
├─────────────────────────────────┤
│  [📍 Map]  [📤 Export]  [🗑️]    │  ← Bottom action bar
└─────────────────────────────────┘
```

### Edit mode

Tap any word → it becomes editable inline. Tap a chip → tag editor opens (change tag type, add species, add weight, add photo).

The transcript is **mutable in review** but **immutable in record**. This is a critical emotional principle: recording should feel like a journal — you don't edit yesterday's journal in the moment.

### Export options

- **Markdown file** (default): the session log as written, with all annotations.
- **PDF**: formatted with map embed, photo strip, structured metadata header.
- **CSV**: structured rows for spreadsheet import (one row per catch/maintenance event).
- **Email / share**: native share sheet.
- **Cloud destinations**: iCloud, Dropbox, Google Drive (configurable).

---

## 5. Offline Behavior

**The cardinal rule:** *Recording never fails because of connectivity.* The app is **offline-first, sync-second.**

### Status states (always visible in header)

| State | Indicator | Meaning |
|---|---|---|
| 🟢 Synced | Solid teal dot | All caught up to cloud |
| 🟠 Offline | Pulsing amber dot | No network; recording to local only |
| 🔄 Syncing | Spinning teal arrows | Currently uploading queued sessions |
| 🔴 Sync failed | Solid red dot | One or more sessions failed; tap to retry |

### What the fisherman sees when offline

**Nothing changes** during recording. The session saves locally with no interruption. The only visible difference:
- Header dot turns amber.
- A subtle line appears below the STOP button: `📴 Saved locally · 4.2 MB`

**That's it.** No modal, no warning, no "you've lost connectivity!" panic. The fisherman trusts the app because the app behaves the same.

### What happens when connectivity returns

- Background sync kicks in automatically (no user action required).
- Header dot animates: amber → spinning teal → solid teal.
- A toast appears briefly: `Synced 3 sessions (12 MB).`
- If a session fails to sync (corruption, auth, etc.), the session shows a red badge in the library: tap → see reason → retry.

### The fisherman never has to think about it

This is the design goal: **offline is invisible.** Sync is a background concern. The fisherman's job is fishing. The app's job is remembering.

### Conflict resolution

If somehow the same session gets edited on two devices (rare):
- Last-write-wins on the transcript body (with merge for non-overlapping edits).
- Tag events merge by ID (no conflicts).
- GPS track takes the union of points (always additive).
- Photos: keep both, append to media list.

---

## 6. Voice Commands — Hands-Free Tagging

**Design philosophy:** Voice commands should feel like talking to a competent first mate who knows the boat. Short, natural, no "computer voice" required.

### Command vocabulary

**Tier 1 — Always listening (wake-word activated when recording):**

These trigger at any point during recording:

| Say... | System does... |
|---|---|
| "Mark catch" | Inserts 🟢 CATCH chip. Prompts for species/weight (or accepts "default"). |
| "Note maintenance" | Inserts 🟠 MAINTENANCE chip. Prompts for what. |
| "Flag this" | Inserts 🔴 FLAG chip (high-priority bookmark). |
| "Pause logging" / "Take a break" | Pauses session. |
| "Resume logging" / "Back online" | Resumes session. |
| "End session" / "That's a wrap" / "We're done" | Stops and saves. |
| "What time is it?" | Speaks current time (if audio on). |
| "Where are we?" | Speaks current GPS. |
| "Add photo" | Triggers camera (tap shutter button on screen, or auto-captures in 3s). |
| "Save that" / "Bookmark" | Generic bookmark (no specific tag type). |

**Tier 2 — Structured parsing (extracted from natural speech):**

The system is constantly parsing for fishing-domain entities:

| Entity | Example utterance | Extracted |
|---|---|---|
| Species | "Got a coho" / "Pulled up a king" | species: coho / king |
| Weight | "About 12 pounds" / "Maybe 8 lbs" | weight: 12 lb |
| Depth | "In 80 fathoms" / "80 feet of water" | depth: 80 fathoms |
| Bait/lure | "On a #6 flasher" / "With herring" | gear: #6 flasher |
| Weather | "Sea's getting lumpy" / "Wind picking up" | weather_note |
| Number | "Three fish on the string" | count: 3 |

These don't insert chips directly — they're **parsed into the structured metadata** for that segment, accessible in the review screen as filterable data.

**Tier 3 — Custom commands:**

Users can define their own. ("Roger that" = mark catch. "Pinnacle" = note maintenance.) Trained on-device after 3-5 uses (lightweight few-shot personalization).

### Confirmation UX

When a command is recognized, the chip appears **immediately** in the transcript — but with a subtle pulse animation. No modal, no "did you mean?" interruption. If it was wrong, the fisherman can tap the chip during review and change it. **Speed of capture beats accuracy of capture.**

If the system is uncertain, the chip appears with a yellow outline (medium confidence). Solid confidence = solid chip.

### Voice command training screen

A one-time setup the first time the app is opened:

```
┌─────────────────────────────────┐
│  Voice commands                 │
│                                 │
│  Tap each command and say it    │
│  the way you'd say it on the    │
│  water. We'll learn your voice. │
│                                 │
│  ┌───────────────────────────┐ │
│  │  "Mark catch"             │ │  ← Tap to record
│  │  ▓▓▓░░░░░░  Listening...  │ │
│  └───────────────────────────┘ │
│                                 │
│  ┌───────────────────────────┐ │
│  │  "Note maintenance"       │ │
│  │  ✓ Trained                │ │
│  └───────────────────────────┘ │
│                                 │
│  ... (5-7 commands)             │
│                                 │
│       [  DONE  ]                │
└─────────────────────────────────┘
```

Each takes ~5 seconds. Total: ~1 minute of training. Skip-able. The system also **improves over time** as it hears the fisherman in real conditions — boat noise, accents, cold-stiffened speech.

---

## 7. Vessel Quest Integration

**Gamification should feel like recognition, not nagging.** A captain doesn't want a video game yelling at them. They want a quiet nod from the dockmaster.

### Reward moments

| Event | XP | Visual |
|---|---|---|
| Complete a session | +50 | Subtle toast at end of session |
| Tag 3+ catches in one session | +25 | Toast |
| Log in 3 days in a row | +100 | Toast + streak indicator |
| Reach 10 hours logged this season | +250 | Level-up animation |
| Complete weekly log streak | +500 | Banner with Vessel Quest logo |

### Toast design

```
┌─────────────────────────────────┐
│                                 │
│        ⚓ +50 XP                │
│   Daily log · 4h 12m · 12 tags  │
│                                 │
└─────────────────────────────────┘
```

- Appears **after** STOP is tapped, on the session-end screen.
- Amber accent, navy background, monospaced numbers.
- Auto-dismisses in 4 seconds, or tap to view Vessel Quest.
- **Never appears mid-session.** Don't break the flow.

### Vessel Quest sync

The app sends anonymized activity events to Vessel Quest:
- Session start/end times
- Tag counts (not content)
- Streak state
- Level state

**The fisherman controls what's shared.** Settings → Privacy → "Share activity with Vessel Quest" (default ON, with a clear toggle).

### Streak display

In the header (subtle, right side):
```
🔥 12-day streak
```

Tiny flame icon + number. Disappears when broken. **No guilt messaging** ("Don't break your streak!"). Just the quiet fact.

---

## 8. Multi-Stream Visualization (Session Replay)

When the boat has connected sensors — sounder, cameras, AIS — the session becomes a **multi-track timeline** that can be scrubbed and replayed. This is the post-trip analysis tool. It's a *different mode* from recording — calmer, more deliberate, often done at the dock with coffee.

### Timeline view

```
┌─────────────────────────────────────────────┐
│  Tue Jul 18 · 0700–1115                     │
├─────────────────────────────────────────────┤
│                                             │
│  Transcript                                 │
│  Pulled the first string about fifteen      │
│  minutes ago, got a nice coho...            │
│                                             │
│  ──────────────────────────────────────     │
│                                             │
│  Audio         ░▒▓█▓▒░░▒▓██▓▒░▒▓█▓▒░░░░░   │
│                                             │
│  Depth (ft)    ──────╲___╱──────╲___╱─────  │
│                                             │
│  Speed (kt)    ───╱──╲──────╱──╲──────────  │
│                                             │
│  Heading       ──────╱─╲─────╱──╲─────────  │
│                                             │
│  Catches       ●           ●           ●    │
│                                             │
│  Maint.                     ▲               │
│                                             │
│  Photos        [▢]       [▢]   [▢]          │
│                                             │
│  ──────────────────────────────────────     │
│  [▶] ━━━━●━━━━━━━━━━━━━━━━━━━━━━━━  4:15    │  ← Scrubber
│       07:00      08:00      09:00   10:00   │
│                                             │
└─────────────────────────────────────────────┘
```

**Each track is a horizontal stripe:**
- **Audio**: amplitude waveform for the whole session.
- **Depth**: line chart from sounder (if connected).
- **Speed**: line chart from GPS.
- **Heading**: line chart from compass.
- **Catches**: green dots at tagged moments.
- **Maintenance**: orange triangles.
- **Photos**: thumbnail squares.

### Scrubbing

A horizontal scrubber at the bottom. Drag → all tracks and the transcript highlight that moment. **The transcript is the index** — tap any spoken word → scrubber jumps to that moment. Reverse: scrub → transcript scrolls to that point.

### Map overlay

Toggle the bottom half to a map view:
- GPS track as a polyline.
- Catch pins at tag locations (color-coded by species).
- Photo pins where photos were taken.
- Tap any pin → transcript scrolls to that moment.

This is the **fishing diary** view — the artifact a captain would print and put in a binder.

### Vessel Quest post-session summary

After a session, an auto-generated card:

```
┌─────────────────────────────────┐
│  Trip Summary · Tue Jul 18      │
│                                 │
│  Duration      4h 15m           │
│  Distance      18.4 nm          │
│  Top speed     8.2 kt           │
│  Catches       12               │
│    · coho      7                │
│    · king      3                │
│    · pink      2                │
│  Maintenance   1                │
│  Weather       Calm → chop      │
│                                 │
│  [📤 Share to Vessel Quest]     │
│  [📥 Export Markdown]           │
└─────────────────────────────────┘
```

---

## 9. The Supervised Learning Dashboard

This is Casey's tool — or any human reviewer — for labeling sessions to improve the model. It's NOT the fisherman's app. It's a web dashboard, designed for keyboard-and-mouse use at a desk.

### Philosophy

- **Batch-first.** Don't make Casey review one transcript at a time. Show patterns.
- **Confidence-driven.** Show Casey the *uncertain* stuff first. High-confidence transcripts need only a glance.
- **Multi-modal.** Transcript + video + sounder + GPS, side by side, time-synced.
- **Labeling should feel productive.** Like a flow state, not paperwork.

### Main layout — "Review Queue"

```
┌─────────────────────────────────────────────────────────────────┐
│ ActiveLog Review    247 sessions pending     [Casey ▾] [⚙️]      │
├──────────────────────┬──────────────────────┬───────────────────┤
│ QUEUE (247)          │ REVIEW               │ ACTIONS           │
│                      │                      │                   │
│ ● Tue Jul 18         │  [07:14:23] 📍 47.6.. │  Catch            │
│   4h · 12 catches    │  Pulled the first     │  Maint.           │
│   confidence: 0.71   │  string about...      │  Weather          │
│                      │                      │  Gear             │
│ ○ Mon Jul 17         │  [07:15:11] 🟢 CATCH  │  Skip             │
│   4h · 8 catches     │  Mark catch — 1 coho. │  Reject           │
│   confidence: 0.88   │                      │                   │
│                      │  ┌──────────────┐    │  [1] Catch        │
│ ○ Sun Jul 16         │  │  Sounder     │    │  [2] Maint.       │
│   2h · 4 catches     │  │   ╲__╱──╲__  │    │  [3] Weather      │
│   confidence: 0.92   │  │              │    │  [4] Gear         │
│                      │  └──────────────┘    │  [5] Skip         │
│ ○ Sat Jul 15         │                      │                   │
│   6h · 22 catches    │  ┌──────────────┐    │  Notes:           │
│   confidence: 0.65   │  │  Camera      │    │  [_____________]  │
│                      │  │   [video]    │    │                   │
│ ... (247 total)      │  │              │    │  [Submit]         │
│                      │  └──────────────┘    │                   │
│                      │                      │                   │
│                      │  ┌──────────────┐    │                   │
│                      │  │  GPS track   │    │                   │
│                      │  │   [map]      │    │                   │
│                      │  └──────────────┘    │                   │
└──────────────────────┴──────────────────────┴───────────────────┘
```

### Three-pane layout

- **Left (Queue):** Sessions sorted by lowest confidence first. Each row shows confidence score, duration, tag count.
- **Center (Review):** The current session, with tabs to switch between:
  - Transcript (read-only, scrubable)
  - Sounder trace (line chart)
  - Camera feed (video player with transcript-synced playback)
  - GPS track (map)
- **Right (Actions):** Keyboard-shortcut-heavy labeling panel.

### Keyboard shortcuts (the speed)

```
1           Mark as Catch
2           Mark as Maintenance
3           Mark as Weather
4           Mark as Gear
5           Skip (no label)
6           Reject (broken/unusable)
→           Next session
←           Previous session
Space       Play/pause video
J/L         Scrub back/forward 5s
Shift+J/L   Scrub back/forward 30s
T           Add tag at current timestamp
Cmd+E       Edit transcript (open editor)
Cmd+S       Submit & next
```

### Confidence-driven auto-approve

For sessions with confidence > 0.95 AND no detected anomalies:
- Show a "Quick approve" button that accepts all auto-labels in one click.
- The labeler's job is the *uncertain* stuff — high-confidence sessions are sanity-checked in bulk.

### Anomaly detection

Sessions are flagged for review if:
- Confidence drops below threshold mid-session.
- GPS shows unusual patterns (e.g., sudden stop, sharp turn).
- Transcript mentions unusual terms (model has flagged "emergency," "fire," "mayday," etc.).
- Sounder trace shows abnormal patterns (potential equipment issue).

Anomalies show up with a ⚠️ icon in the queue.

### Annotation editor

For correcting transcript errors:

```
┌─────────────────────────────────────────────┐
│  Edit transcript                            │
│                                             │
│  [07:14:23] Pulled the first string about   │
│  fifteen minutes ago, got a [coho] on the   │
│  downrigger, maybe [eight] pounds...        │
│           ↑                  ↑              │
│      highlighted terms (low confidence)     │
│                                             │
│  Suggestions:                               │
│    "coho"  →  [chinook] [silver] [keep]     │
│    "eight" →  [8 lb] [18 lb] [keep]         │
│                                             │
│  [Save corrections] [Skip]                  │
└─────────────────────────────────────────────┘
```

This is the **active learning loop**: Casey corrects → model retrains → confidence improves → less review needed over time.

### Metrics dashboard

For Casey (and product):

```
┌─────────────────────────────────────────────┐
│  Model Performance                          │
│                                             │
│  Transcript WER       8.4%   (↓ 2.1%)       │
│  Catch detection F1   0.91   (↑ 0.03)       │
│  Species accuracy     0.87   (↑ 0.05)       │
│  GPS injection drift  0.3m   (stable)       │
│                                             │
│  Hours reviewed       247                   │
│  Hours total         1,842                  │
│  Auto-approved       73%                    │
│                                             │
│  [📊 Detailed report]                       │
└─────────────────────────────────────────────┘
```

The trajectory matters: as the model improves, less human review is needed. **Casey's job is to work themselves out of the loop** — the goal is a model good enough that ActiveLog is genuinely hands-off for the fisherman.

---

## 10. User Flows (the critical paths)

### Flow A: "I just caught a fish, log it"

```
Fisherman catches a fish.
  → Sets the rod down, picks up phone (or phone is in chest harness).
  → Says "Mark catch."
  → System beeps + haptic, green chip appears in transcript.
  → Says "Coho, about 8 pounds."
  → System parses: chip updates to "🟢 CATCH · coho · 8 lb."
  → Fisherman puts phone down, continues fishing.
Total time: 4 seconds. Eyes: 0 seconds on phone if using chest harness.
```

### Flow B: "I'm done for the day"

```
Fisherman ties up at the dock.
  → Taps STOP button (or says "End session").
  → Session ends, summary card appears.
  → Toast: "⚓ +50 XP · Daily log · 4h 15m · 12 tags"
  → Toast auto-dismisses after 4s.
  → Fisherman puts phone in pocket.
  → Behind the scenes: session encrypts, syncs to cloud.
  → Optional: Tap "Export Markdown" to share log.
```

### Flow C: "Connectivity dropped mid-trip"

```
Fisherman is 30nm offshore, cell signal gone.
  → Recording continues. Header dot turns amber.
  → Subtle line appears: "📴 Saved locally · 4.2 MB"
  → Fisherman doesn't notice or care — they're fishing.
  → Trip ends. They head home. Cell signal returns at the marina.
  → Background sync runs. Header dot → spinning teal → solid teal.
  → Toast: "Synced 1 session (4.2 MB)."
Total user intervention: zero.
```

### Flow D: "I want to remember what worked last Tuesday"

```
Fisherman at the dock, planning tomorrow's trip.
  → Opens app → Library.
  → Taps search bar (or voice: "Search sessions").
  → Says "Coho last Tuesday."
  → List filters to that session.
  → Taps session → reads transcript, sees catches, map.
  → Thinks "ah, the #6 flasher worked at 80 fathoms."
  → Closes app.
```

### Flow E: "I want to share my season log with my daughter"

```
Fisherman at home, end of season.
  → Opens app → Library → taps season filter.
  → Selects all sessions.
  → Taps "Export" → "PDF (full season)."
  → System generates a single PDF with all sessions, maps, photos.
  → AirDrops to daughter's phone.
  → Daughter reads: "Wow, dad, you caught 247 fish this year."
  → Emotional moment. The technology got out of the way.
```

---

## 11. Emotional Design — What Should the Fisherman FEEL?

**At the moment they open the app:**
- *Capable.* "This is a tool that respects my work."
- *Unbothered.* "Nothing here is going to demand my attention."

**At the moment they hit START:**
- *Decisive.* "I'm beginning my log. The day starts now."
- *Trusted.* "The app is taking care of the rest."

**During a long session:**
- *Unseen.* The app should feel like a quiet presence, like a good crew member who knows when to shut up.
- *Captured.* If they glance at the screen, they should feel "yes, it's all there."

**At the moment of a big catch:**
- *Heroic.* The "Mark catch" command should feel like a *callout* — "I caught this, and the world should know."
- *Quick.* 4 seconds or less from "fish on deck" to "logged." No friction.

**At the end of a long day:**
- *Tired but satisfied.* The session summary card should feel like a captain's log entry — proud, factual, complete.
- *Not guilty.* No "you forgot to log X!" nags. The app records what was said. If they didn't say it, it didn't happen. That's fine.

**At the end of the season:**
- *Proud.* The library, the maps, the totals — it's the chronicle of a professional's year.
- *Connected.* Vessel Quest ties them to a community. Their work is part of something larger.

**At the moment of failure (sync error, dropped session):**
- *Reassured.* "Your session is safe locally. We will sync when we can."
- *Recoverable.* No catastrophic loss. Always recoverable.

---

## 12. Anti-Patterns — What We Will NOT Do

- ❌ **No tiny text.** No 12pt UI. Minimum 14pt, body 18pt.
- ❌ **No modal interruptions during recording.** Ever. Confirmation toasts only.
- ❌ **No "are you sure?" prompts for destructive actions during recording.** Delete = two taps from library, never during session.
- ❌ **No gamification sounds during fishing.** Chimes and XP toasts only on session end.
- ❌ **No emoji-heavy UI.** Marine icons where they aid recognition, but not a wall of emoji.
- ❌ **No loading spinners blocking the transcript.** Recording is real-time; the UI must keep up.
- ❌ **No "tap to rate this session" or other engagement bait.** This is a tool, not a social network.
- ❌ **No dark patterns.** No "share to 3 friends to unlock export." No nag screens.
- ❌ **No accidental data loss.** Deleting a session = swipe + confirm + undo snackbar for 5s.
- ❌ **No required sign-up.** First-run works fully offline. Cloud sync is optional and configured after first session.

---

## 13. Accessibility & Inclusion

- **One-handed operation:** All primary actions reachable with thumb on right side.
- **Voice control always available:** Even in settings, common actions have voice equivalents.
- **High contrast mode:** Pure black background + pure white text option for low-vision users.
- **Large-text mode:** All UI scales 1.3x. Transcript body scales independently.
- **Colorblind-safe palette:** CATCH (green), MAINTENANCE (amber), FLAG (red) are also distinguished by shape (●, ▲, ⬛) and label text — never color alone.
- **Bilingual support:** English + Spanish at launch. Voice commands trained on both.
- **Hearing accessibility:** Full visual transcript. Optional caption display during playback.
- **Reduced motion mode:** Disables all animations (waveform pulses, sync spinners replaced with static icons).

---

## 14. Summary — The Three Screens That Matter

**1. The Recording Screen** (95% of use, while fishing)
- Giant START/STOP button
- Live transcript with inline annotations
- Audio waveform + confidence dots
- Voice command chips as they happen
- Zero friction, zero interruption

**2. The Library Screen** (4% of use, planning or remembering)
- Cards with map thumbs, dates, durations
- Search & filter
- Quick export to PDF/Markdown/CSV

**3. The Session Detail Screen** (1% of use, reviewing or exporting)
- Read-only transcript with tappable chips and words
- Map view, photo strip, structured metadata
- Bottom action bar: Map / Export / Delete

**Everything else is settings, which should be buried.**

---

## 15. Open Questions for Next Iteration

1. **Audio storage:** Do we keep audio recordings alongside transcripts, or discard after transcription? (Storage cost vs. re-listen for QA.) Suggest: keep for 30 days, then auto-purge unless flagged.
2. **Photo storage:** Full-res on device, compressed in cloud? Need a max-per-session cap (say 50)?
3. **Multi-user boats:** If 3 crew each log, how do we reconcile? Suggest: each gets own session, optional merge at end of day with captain's approval.
4. **Sounder integration:** Proprietary protocols (Furuno, Garmin, Simrad) — partner integrations vs. NMEA 0183/2000 generic? Start with NMEA, partner later.
5. **Watch/companion device:** Garmin watches, Apple Watch — voice command relay?
6. **Translation:** If a fisherman logs in Spanish and Vessel Quest is English-speaking, translate at view-time or store both?
7. **Voice biometric login:** "Say your boat name to log in" — convenient or gimmicky?

---

*"The best marine electronics disappear. You forget they're there until you need them — and then they're exactly right."*

That's the bar. ActiveLog.Ai should feel like a depth sounder that also takes dictation and remembers everything.

— Brainstorm complete. Ready for wireframe renders, prototype specs, or technical architecture next.
