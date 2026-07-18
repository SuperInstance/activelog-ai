# ActiveLog.Ai

> Phone-as-transcription-device. Location-annotated voice logs for vessel operations.
> Edge-first. Offline-capable. Cloudflare-backed.

## What It Does

A fisherman opens ActiveLog.Ai on their phone. They press START. The phone transcribes everything they say using the browser's built-in speech recognition. Every 60 seconds, the system injects a timestamp + GPS location. When done, they have a markdown session file — locally stored, optionally synced to Cloudflare D1, optionally vectorized for semantic search.

## Features

- 🎙️ **Real-time transcription** — Web Speech API, no server needed, works in Chrome/Safari
- 📍 **GPS annotations** — latitude/longitude injected every 60 seconds (configurable)
- 🏷️ **Voice tags** — say "mark catch" or tap buttons to tag segments
- 📝 **Markdown export** — clean session files with metadata header
- 💾 **Offline-first** — full local storage in localStorage, syncs when online
- ☁️ **Cloudflare D1** — optional cloud sync with SQLite database
- 🔍 **Vectorize search** — semantic search across all sessions (paid Cloudflare)
- 🔗 **Vessel integration** — timestamped transcript aligns with sounder + camera data

## Quick Start

### Deploy on your Cloudflare account

```bash
# Create resources
wrangler d1 create activelog
wrangler vectorize create activelog-embeddings --dimensions=384
wrangler r2 bucket create activelog-audio

# Update wrangler.toml with the database_id from d1 create

# Run migrations
wrangler d1 execute activelog --file=schema.sql

# Deploy
wrangler pages deploy src --project-name=activelog-ai
```

### Use locally (no Cloudflare needed)

Open `src/index.html` in Chrome or Safari on your phone. The app works fully offline — transcription, GPS annotation, local storage, markdown export. Cloud sync is optional.

## Voice Commands

| Say this | What happens |
|----------|-------------|
| "mark catch" | Tags next segment as catch |
| "mark maintenance" | Tags maintenance |
| "mark weather" | Tags weather |
| "mark navigation" | Tags navigation |
| "flag this" | Flags as important |
| "end session" | Stops recording |

## Session File Format

```markdown
# ActiveLog Session — 2026-07-18

**Started:** 2026-07-18T14:00:00Z
**Ended:** 2026-07-18T15:47:00Z
**Duration:** 1h 47m 0s
**Location Start:** 56.8023°, 135.4567°
**Location End:** 56.8201°, 135.4890°

---

**📍 56.8023°, 135.4567° | 🕐 14:00:00 UTC**

Okay we're setting the first string on the eastern edge of the flat.
Wind's out of the southwest maybe fifteen knots...

**📍 56.8031°, 135.4559° | 🕐 14:01:00 UTC**

Mark, set one is in the water. Eighteen fathoms...

[tag:catch] That's a good mark right there. See the school suspended
about ten fathoms off the bottom? [important]
```

## Architecture

```
Phone (Browser)              Cloudflare Edge
┌─────────────────┐          ┌──────────────────┐
│ Web Speech API   │         │ Pages (static)   │
│ Geolocation API  │ ──sync──│ Worker (API)     │
│ IndexedDB        │         │ D1 (sessions)    │
│ Markdown export  │         │ Vectorize (search)│
└─────────────────┘          │ R2 (audio)       │
                             └──────────────────┘
```

## Integration with Vessel Systems

ActiveLog sessions are timestamped in UTC. Sounder data is timestamped. Camera footage is timestamped. All three can be aligned post-hoc:

```
14:00:00 — transcript: "setting first string"
14:00:00 — sounder: depth 18fm, marks at 8fm
14:00:00 — camera: (not deployed)
14:32:00 — transcript: "hauling, looks like good sablefish"
14:32:00 — sounder: depth 18fm, dense marks
14:32:00 — camera: deployed at 18fm, footage shows fish
```

The transcript becomes the **temporal spine** for multi-stream vessel data analysis.

## Domain

**activelog.ai** — point this at the Cloudflare Pages deployment.
