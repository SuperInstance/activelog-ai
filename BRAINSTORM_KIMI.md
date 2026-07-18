# ActiveLog.Ai — Architecture Brainstorm

**Author:** Cloudflare systems architect (subagent)
**Date:** 2026-07-18
**Status:** Draft v1 — for Casey's review
**Target:** Commercial fishing vessel data collection, edge-first, offline-tolerant

---

## 0. Executive Summary

ActiveLog.Ai turns a phone (or tablet) into a **location-annotated, time-synced transcription device** that captures deck observations on a commercial fishing boat. The boat is offline for hours at a time. The system **must work edge-first** — local-first is the default, the cloud is a destination, not a dependency.

**Three operating modes** (user picks one, can upgrade later):

| Mode | Storage | Search | Auth |
|------|---------|--------|------|
| **Local-only** | Markdown on device | ripgrep | None (anonymous) |
| **Cloud sync** | Local + own D1 | SQL queries | Cloudflare API token |
| **Cloud + AI** | Local + own D1 + own Vectorize | Semantic search | Cloudflare API token |

The user owns their data. We don't host D1 instances — we hand them a Terraform/CLI snippet that provisions resources in **their own Cloudflare account**, and we sync via API token. This is the inverse of the typical SaaS model and it sidesteps Workers for Platforms entirely.

**Core Cloudflare stack:** Pages (static frontend) + Workers (sync API + AI inference) + Workers AI (Whisper, embeddings) + D1 (per-user) + Vectorize (per-user) + R2 (per-user media) + Access (optional dashboard auth).

---

## 1. Authentication Architecture

### The core tension

Casey's users are fishermen. Most do not have Cloudflare accounts. We need three classes of user:

1. **Anonymous / local-only** — no Cloudflare account, no signup. App works fully offline.
2. **Cloudflare-free account** — sign up for one inside the app via a hosted flow, get auto-provisioned resources.
3. **Power user** — already has Cloudflare, brings their own resources.

### Proposed scheme

```
┌──────────────────────────────────────────────────────────────────┐
│  Tier 1: Anonymous (no auth, no Cloudflare)                      │
│  - All data stays in IndexedDB + local FS                       │
│  - Markdown export only                                          │
│  - "Claim your data later" — generates portable backup bundle    │
└──────────────────────────────────────────────────────────────────┘
            │ user clicks "Connect Cloudflare"
            ▼
┌──────────────────────────────────────────────────────────────────┐
│  Tier 2: Hosted account (we create a Cloudflare sub-account)    │
│  - We use Cloudflare's Partner API (deprecated) OR              │
│  - Simpler: We use a managed multi-tenant Cloudflare account    │
│    with one D1/Vectorize/R2 bucket *per user* (namespace)       │
│  - User signs up with email + password                          │
│  - Auth via Clerk/Auth0/Stytch on the frontend                   │
│  - Backend identifies user via JWT, dispatches to their namespace│
└──────────────────────────────────────────────────────────────────┘
            │ user wants full ownership
            ▼
┌──────────────────────────────────────────────────────────────────┐
│  Tier 3: BYO Cloudflare (Bring Your Own)                        │
│  - User runs `wrangler activelog init` in their terminal        │
│  - Provisions their own D1 + Vectorize + R2 + Worker            │
│  - We receive a scoped API token (D1:Edit, Vectorize:Edit,       │
│    R2:Edit on their bucket)                                     │
│  - Token encrypted with passphrase, stored in IndexedDB         │
│  - ActiveLog.Ai Worker calls Cloudflare API *as them*           │
└──────────────────────────────────────────────────────────────────┘
```

### Why this beats the alternatives

| Approach | Verdict |
|----------|---------|
| **Cloudflare Access** | Only works for users who already have a Cloudflare org. Rejected for Tier 1/2. Useful for protecting the **optional dashboard** (Tier 3 admin). |
| **OAuth via Cloudflare** | Doesn't exist for general use. Only Access has an OAuth flow, and it's org-scoped. Rejected. |
| **API tokens from each user** | ✅ Works. Token is the entire auth boundary. We never see their password. Revocable from their dashboard. |
| **Workers for Platforms** | Wrong tool. WfP deploys *user code*. We're deploying *our* code that calls *their* Cloudflare API. Not WfP. |

### Concrete auth flow (Tier 3 BYO)

```typescript
// pages/onboarding.tsx
const handleConnect = async () => {
  // 1. User goes to dash.cloudflare.com/profile/api-tokens
  // 2. Creates token with template "Edit Cloudflare Workers" + D1 + Vectorize + R2
  // 3. Pastes token into our form
  // 4. We POST to our Worker to validate it
  const res = await fetch('/api/auth/validate-token', {
    method: 'POST',
    body: JSON.stringify({ token })
  })
  const { accountId, d1Id, vectorizeId, r2Bucket } = await res.json()
  // 5. We store these IDs in IndexedDB (encrypted with passphrase)
  await saveCredentials({ token, accountId, d1Id, ... })
}
```

```typescript
// workers/api/src/auth/validate.ts
export async function validateToken(token: string, env: Env) {
  const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  const { success, result } = await res.json()
  if (!success) throw new Error('Invalid token')
  // Now check the token can actually do what we need
  const perms = result.scopes
  // ... probe D1, Vectorize, R2 with a dry-run query
  return { accountId: result.account.id, ... }
}
```

**Encryption:** API token is encrypted with **Argon2id-derived key from user passphrase** before storing in IndexedDB. We never see the plaintext. If user loses passphrase, they re-enter token.

---

## 2. Multi-tenant D1 Strategy

### The decision: API-token-mediated, not Workers for Platforms

Workers for Platforms lets a *platform owner* deploy user-defined scripts into dispatch namespaces. **We don't need that.** We deploy *our* Worker once. That Worker, when authenticated as a user, writes to *their* D1 using their token.

```
┌─────────────────────┐
│  ActiveLog.Ai       │
│  Worker (our acct)  │
│                     │
│  Receives:          │
│   - session data    │
│   - user API token  │
│                     │
│  Calls:             │
│   - api.cloudflare  │
│     .com/.../d1/    │
│     database/{id}   │
│     /query          │
└─────────────────────┘
            │
            │ Authorization: Bearer {user_token}
            ▼
┌─────────────────────┐
│  Cloudflare API     │
│  (in user's acct)   │
│                     │
│  - their D1         │
│  - their Vectorize  │
│  - their R2         │
└─────────────────────┘
```

### Schema (D1)

```sql
-- Single database per user, namespace isolates per-table

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- ulid
  vessel_id TEXT,
  started_at INTEGER NOT NULL,   -- unix ms
  ended_at INTEGER,
  device TEXT,                   -- "iPhone 14 Pro" 
  notes TEXT
);

CREATE TABLE transcripts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  t_offset_ms INTEGER NOT NULL,  -- ms from session start
  source TEXT NOT NULL,          -- "web_speech" | "whisper" | "manual"
  confidence REAL,
  text TEXT NOT NULL,
  raw_audio_r2_key TEXT          -- pointer to R2 object
);

CREATE TABLE geo_pings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  t_offset_ms INTEGER NOT NULL,
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  accuracy_m REAL,
  speed_mps REAL,
  heading_deg REAL,
  source TEXT                    -- "browser" | "nmea" | "manual"
);

CREATE TABLE vessel_signals (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  t_offset_ms INTEGER NOT NULL,
  kind TEXT NOT NULL,            -- "depth" | "sst" | "wind" | "sounder_image"
  payload TEXT NOT NULL,         -- JSON
  media_r2_key TEXT
);

CREATE TABLE annotations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  t_offset_ms INTEGER NOT NULL,
  label TEXT NOT NULL,           -- "cod school" | "rocky bottom"
  t_end_offset_ms INTEGER,
  geo_ping_id TEXT REFERENCES geo_pings(id),
  vector_id TEXT                 -- pointer to Vectorize
);

CREATE INDEX idx_transcripts_session ON transcripts(session_id, t_offset_ms);
CREATE INDEX idx_geo_session ON geo_pings(session_id, t_offset_ms);
CREATE INDEX idx_annotations_session ON annotations(session_id, t_offset_ms);

CREATE TABLE sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);
```

### Sync protocol (worker endpoint)

```typescript
// workers/api/src/routes/sync.ts
export async function handleSync(req: Request, env: Env) {
  const { token, accountId, d1DatabaseId } = await authenticate(req)
  const session = await req.json<SyncPayload>()
  
  // Batch insert via Cloudflare D1 HTTP API
  const queries = [
    batchInsert('sessions', [session.meta]),
    batchInsert('transcripts', session.transcripts),
    batchInsert('geo_pings', session.geo_pings),
    // ...
  ]
  
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${d1DatabaseId}/query`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql: queries.join(';') })
    }
  )
  return Response.json({ ok: res.ok, count: session.transcripts.length })
}
```

**Workers for Platforms alternative** — only worth it if we want to deploy *per-user* logic. We don't. The dispatch namespace pattern would be: our Worker receives a request, looks up the user's namespace, forwards the request to their Worker. **Adds latency, complexity, and one more failure mode. Skip.**

### Cost note

D1 HTTP API calls from the Worker to the user's account are **free** (they're API calls, not Worker requests on our side). The user's D1 has its own free tier (5GB, 5M reads/day, 100K writes/day). For commercial fishing use case, well within limits.

---

## 3. Transcription Pipeline

### The matrix

| Engine | Cost | Quality | Offline? | Latency | Verdict |
|--------|------|---------|----------|---------|---------|
| **Web Speech API** | Free | Mediocre (noisy envs) | ✅ if Chrome language pack installed | Streaming | Default in-app |
| **Cloudflare Workers AI Whisper** (`@cf/openai/whisper`) | $0.002/min | High | ❌ needs network | Async | Sync upgrade |
| **OpenAI Whisper API** | $0.006/min | High | ❌ | Async | Skip (Cloudflare cheaper) |
| **Local Whisper.cpp** | Free | High | ✅ | Battery-heavy | Future: Capacitor app |
| **AssemblyAI** | $0.00025/s | High | ❌ | Async | Skip |

### The decision: **dual-track**

```
                        ┌──────────────────────────┐
 Audio capture          │  MediaRecorder API       │
 (always on)            │  - opus/webm chunks      │
                        │  - 30s segments          │
                        │  - write to IndexedDB    │
                        │  - also push to R2       │
                        └────────────┬─────────────┘
                                     │
              ┌──────────────────────┴─────────────────────┐
              │                                            │
              ▼                                            ▼
   ┌──────────────────────┐                 ┌──────────────────────────┐
   │  Web Speech API      │                 │  Cloudflare Whisper      │
   │  (real-time)         │                 │  (batch, online only)    │
   │                      │                 │                          │
   │  - interim results   │                 │  - runs on R2 audio      │
   │  - final results     │                 │  - returns transcript    │
   │  - emits Transcript  │                 │  - replaces/augments     │
   │    Chunk events      │                 │    Web Speech version    │
   └──────────┬───────────┘                 └────────────┬─────────────┘
              │                                          │
              └──────────────────┬───────────────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │  Reconciler                  │
                  │  - picks best per segment    │
                  │  - merges timestamps         │
                  │  - emits to sync queue       │
                  └──────────────────────────────┘
```

### Why both

- **Web Speech** runs locally, gives instant feedback on deck. Crucial when the captain wants to see what was just said.
- **Whisper** is higher quality, especially for technical fishing terms (species names, gear jargon) and noisy environments (engine, wind). Runs async when online.
- Reconciler prefers Whisper when confidence > 0.85, falls back to Web Speech when offline.

### Browser integration (frontend)

```typescript
// lib/transcription/web-speech.ts
export class WebSpeechTranscriber {
  private recognition: SpeechRecognition
  
  constructor() {
    this.recognition = new webkitSpeechRecognition()
    this.recognition.continuous = true
    this.recognition.interimResults = true
    this.recognition.lang = 'en-US'
    // CRITICAL for fishing: tune for noise
    this.recognition.maxAlternatives = 1
  }
  
  start(onChunk: (chunk: TranscriptChunk) => void) {
    this.recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          onChunk({
            text: result[0].transcript,
            confidence: result[0].confidence,
            t_offset_ms: performance.now() - this.startTime,
            source: 'web_speech',
            isFinal: true
          })
        }
      }
    }
    this.recognition.start()
  }
}
```

```typescript
// workers/api/src/routes/transcribe.ts
// Whisper batch processing endpoint
export async function handleTranscribe(req: Request, env: Env) {
  const { audioR2Key, sessionId, tOffsetMs } = await req.json<TranscribeRequest>()
  
  // Get signed URL for the audio
  const audio = await env.MEDIA_BUCKET.get(audioR2Key)
  if (!audio) return new Response('Audio not found', { status: 404 })
  
  // Run Workers AI Whisper
  const response = await env.AI.run('@cf/openai/whisper', {
    audio: [...new Uint8Array(await audio.arrayBuffer())]
  })
  
  // Store the higher-quality transcript
  await storeTranscripts([{
    session_id: sessionId,
    t_offset_ms: tOffsetMs,
    source: 'whisper',
    text: response.text,
    confidence: 1.0,  // Whisper doesn't emit per-word confidence
    raw_audio_r2_key: audioR2Key
  }])
  
  return Response.json({ text: response.text })
}
```

### Offline Whisper fallback

For multi-day trips with no connectivity, we ship a **Capacitor/React Native app version** that bundles `whisper.cpp` compiled to ARM64. Phonemes ship with the app (~150MB). Trade-off: app size. Decision deferred until we know typical trip duration and connectivity windows.

---

## 4. Geolocation Strategy

### The reality on a boat

A phone's GPS on a commercial fishing vessel faces:
- **Multipath** off the wheelhouse, mast, and rigging
- **Signal blockage** inside the cabin (where captain often sits to dictate)
- **Heading error** during sudden turns (set/haul, net retrieval)
- **Drift during long sets** — phone may be off for hours, cold start fixes take 30-60s

### Multi-source strategy

```
Priority chain (highest to lowest):
1. NMEA from boat's GPS via Signal K WebSocket (boat's antenna, 2-3m accuracy)
2. Phone GPS with high-accuracy mode (3-5m if sky visible)
3. Phone GPS standard mode (10-30m)
4. Manual lat/lon entry
5. Manual "Station name" lookup (e.g., "Hot Spot 3")
```

### Browser API

```typescript
// lib/geo/watcher.ts
export class GeoWatcher {
  private watchId: number | null = null
  private recentPings: GeoPing[] = []  // rolling buffer
  
  start(sessionStartMs: number) {
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onPosition(pos, sessionStartMs),
      (err) => this.onError(err),
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 0
      }
    )
  }
  
  private onPosition(pos: GeolocationPosition, sessionStartMs: number) {
    const ping: GeoPing = {
      t_offset_ms: Date.now() - sessionStartMs,
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy_m: pos.coords.accuracy,
      speed_mps: pos.coords.speed,
      heading_deg: pos.coords.heading,
      source: 'browser'
    }
    this.recentPings.push(ping)
    
    // Emit every 60s OR when drift > 100m
    if (this.shouldEmitInterjection()) {
      this.emitInterjection(ping)
    }
  }
  
  private shouldEmitInterjection(): boolean {
    const last = this.recentPings[this.recentPings.length - 1]
    const first = this.recentPings[0]
    if (last.t_offset_ms - first.t_offset_ms >= 60_000) return true
    
    // Also emit on significant drift (set/haul)
    const drift = haversineMeters(first, last)
    return drift > 500
  }
}
```

### NMEA / Signal K fallback

If the boat has a chartplotter running Signal K (open-source marine data server), the phone joins the boat's WiFi and subscribes:

```typescript
// lib/geo/signalk.ts
export class SignalKSource {
  private ws: WebSocket | null = null
  
  connect(host: string, sessionStartMs: number) {
    this.ws = new WebSocket(`ws://${host}/signalk/v1/stream?subscribe=all`)
    
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.context === 'vessels.self' && msg.path === 'navigation.position') {
        this.onPosition({
          lat: msg.value.latitude,
          lon: msg.value.longitude,
          t_offset_ms: Date.now() - sessionStartMs,
          source: 'nmea'
        })
      }
      if (msg.path === 'navigation.speedOverGround') { /* ... */ }
      if (msg.path === 'environment.depth.belowKeel') { /* ... */ }
    }
  }
}
```

**Detection:** phone mDNS-browses for `_signalk._tcp` on the local network. If found, prefers Signal K. Otherwise falls back to browser GPS.

### Manual override

```typescript
// Manual entry UI: lat/lon, or station picker
// "I'm at Station 4, 80 fathom mark"
// Stored with source = "manual", high confidence, taints no other data
```

---

## 5. Sync Architecture

### Local-first by mandate

The boat is offline for **hours** at a time. Sync is opportunistic, never blocking.

```
┌─────────────────────────────────────────────────────────────────┐
│  Local device (phone/tablet)                                    │
│                                                                 │
│  ┌─────────────────┐   ┌─────────────────┐   ┌───────────────┐ │
│  │  IndexedDB      │   │  Service Worker │   │  File System  │ │
│  │  - queue        │◄──┤  - background   │──►│  Access API   │ │
│  │  - transcripts  │   │    sync         │   │  - .md files  │ │
│  │  - geo pings    │   │  - retry logic  │   │               │ │
│  │  - media blobs  │   │  - online det.  │   └───────────────┘ │
│  └─────────────────┘   └────────┬────────┘                     │
│                                │                                │
└────────────────────────────────┼────────────────────────────────┘
                                 │ HTTPS (when online)
                                 ▼
                  ┌──────────────────────────────┐
                  │  ActiveLog.Ai Worker         │
                  │  (api.activelog.ai)          │
                  │                              │
                  │  - authenticates user token  │
                  │  - batches inserts           │
                  │  - calls user's D1 API       │
                  │  - calls user's Vectorize    │
                  │  - calls user's R2           │
                  └──────────────────────────────┘
```

### Local schema (IndexedDB)

```typescript
// lib/storage/db.ts
const db = await openDB('activelog', 1, {
  upgrade(db) {
    db.createObjectStore('sessions', { keyPath: 'id' })
    db.createObjectStore('transcripts', { keyPath: 'id', autoIncrement: true })
    db.createObjectStore('geo_pings', { keyPath: 'id', autoIncrement: true })
    db.createObjectStore('media_blobs', { keyPath: 'id' })
    
    // Sync queue: items waiting to upload
    const syncStore = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true })
    syncStore.createIndex('by_status', 'status')  // 'pending' | 'syncing' | 'failed'
    syncStore.createIndex('by_kind', 'kind')
  }
})

async function enqueueSync(item: SyncItem) {
  await db.add('sync_queue', { ...item, status: 'pending', attempts: 0, created_at: Date.now() })
}

async function processQueue() {
  const pending = await db.getAllFromIndex('sync_queue', 'by_status', 'pending')
  for (const item of pending) {
    try {
      await upload(item)
      await db.delete('sync_queue', item.id)
    } catch (e) {
      await db.put('sync_queue', { ...item, attempts: item.attempts + 1, status: item.attempts > 5 ? 'failed' : 'pending' })
    }
  }
}
```

### Service worker

```typescript
// sw.ts
self.addEventListener('sync', (event) => {
  if (event.tag === 'activelog-sync') {
    event.waitUntil(processQueue())
  }
})

// Background sync registration (from page):
await registration.sync.register('activelog-sync')
```

### Markdown file format

Each session writes one markdown file. Format:

```markdown
---
session_id: 01HXYZ...
vessel: "F/V Northern Lights"
started_at: 2026-07-18T14:00:00Z
ended_at: 2026-07-18T18:32:00Z
device: "iPhone 14 Pro"
crew: ["Casey", "Marcus"]
gear: "longline, seabird rig"
---

# Session 01HXYZ — 2026-07-18

## 14:00:12 UTC · 58.234°N, -152.456°W (acc 4m) · speed 6.2kts heading 087°

Setting longline, north end of charted reef.

## 14:01:34

Hauler on station. Skiff deployed for line setting.

## 14:05:00 UTC · 58.235°N, -152.451°W · heading 092°

First hook over. Bait — frozen herring, 1.5 oz.

## 14:05:48 UTC · 58.236°N, -152.448°W

[whisper] Captain notes heavy SW swell, four to six feet, period eight seconds.

## 14:07:12

[manual] Switched to squid bait at hook 23. Herring running low.

## 14:10:00 UTC · 58.240°N, -152.441°W · sounder shows bottom at 142m

[annotation:rocky_bottom] Hard bottom, scattered boulders visible on sounder. Good structure for halibut.

## 14:15:32 UTC · 58.244°N, -152.435°W · 142m depth

[annotation:cod_school] Mark — possible cod school at 110-130m. Tight marks, 8-12m off bottom.

...

## Appendix: Geo Track

```geojson
{
  "type": "LineString",
  "coordinates": [
    [-152.456, 58.234],
    [-152.451, 58.235],
    ...
  ]
}
```

## Appendix: Media Manifest

| Time offset | Kind | R2 key | Notes |
|-------------|------|--------|-------|
| 00:10:00 | sounder_image | sessions/01HXYZ/sounder/0001.png | depth 142m |
| 00:12:00 | camera_underwater | sessions/01HXYZ/cam/0001.mp4 | drop cam |
| 00:30:00 | audio_segment | sessions/01HXYZ/audio/0001.webm | whisper source |
```

### Sync strategy: **chunked, ordered, idempotent**

- Each sync batch: ≤100 transcripts, ≤500 geo pings, ≤10 media uploads
- Use ULIDs (sortable by time) so retries are idempotent
- Server-side: `INSERT OR IGNORE` on primary keys, `last_synced_at` watermark in `sync_meta`

---

## 6. Vectorize Integration

### When it kicks in

Only for **Tier 2 and Tier 3 users** (cloud account required). Local-only users don't get semantic search — they get ripgrep over their markdown files (which is genuinely good).

### Embedding model

Workers AI options:

| Model | Dim | Cost | Notes |
|-------|-----|------|-------|
| `@cf/baai/bge-base-en-v1.5` | 768 | Free tier eligible | Good baseline |
| `@cf/baai/bge-large-en-v1.5` | 1024 | Free tier eligible | Better retrieval |
| `@cf/baai/bge-m3` | 1024 | Free tier eligible | Multilingual, longer context |

**Recommendation:** `@cf/baai/bge-large-en-v1.5` — quality matters more than a few extra ms of inference.

### Chunking strategy

Transcripts vary in length. Don't embed the whole session — too coarse. Chunk by:

1. **Time window** — every 5 minutes, or split at pauses > 10s
2. **Topic shift** — naive (every N sentences) at first, smarter later
3. **Annotation boundaries** — never split inside a labeled annotation

```typescript
// lib/vectorize/chunker.ts
export function chunkTranscript(
  transcripts: Transcript[],
  geoPings: GeoPing[],
  windowMs = 5 * 60 * 1000
): VectorChunk[] {
  // Sort by time
  const sorted = [...transcripts].sort((a, b) => a.t_offset_ms - b.t_offset_ms)
  
  const chunks: VectorChunk[] = []
  let current: Transcript[] = []
  let windowStart = 0
  
  for (const t of sorted) {
    if (current.length === 0) {
      windowStart = t.t_offset_ms
      current.push(t)
      continue
    }
    if (t.t_offset_ms - windowStart > windowMs) {
      chunks.push(makeChunk(current, geoPings, windowStart))
      current = [t]
      windowStart = t.t_offset_ms
    } else {
      current.push(t)
    }
  }
  if (current.length > 0) chunks.push(makeChunk(current, geoPings, windowStart))
  
  return chunks
}

function makeChunk(transcripts: Transcript[], geoPings: GeoPing[], windowStart: number): VectorChunk {
  const text = transcripts.map(t => t.text).join(' ')
  const nearbyGeo = geoPings
    .filter(g => Math.abs(g.t_offset_ms - windowStart) < 5 * 60 * 1000)
    .reduce((acc, g) => [...acc, [g.lon, g.lat]], [] as number[][])
  
  return {
    text,
    metadata: {
      session_id: transcripts[0].session_id,
      t_offset_ms: windowStart,
      t_end_offset_ms: transcripts[transcripts.length - 1].t_offset_ms,
      geo_polygon: nearbyGeo,  // GeoJSON LineString
      source: 'transcript',
      vessel_id: transcripts[0].vessel_id
    }
  }
}
```

### Embedding & indexing

```typescript
// workers/api/src/routes/embed.ts
export async function embedSession(sessionId: string, env: Env, ctx: { token, accountId, vectorizeId }) {
  const chunks = await fetchSessionChunks(sessionId, ctx)
  
  // Batch embed (Workers AI batch limit: 100)
  const batchSize = 100
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize)
    const texts = batch.map(c => c.text)
    
    const embeddings = await env.AI.run('@cf/baai/bge-large-en-v1.5', {
      text: texts
    }) as { data: number[][] }
    
    // Upload to user's Vectorize via API
    const vectors = batch.map((chunk, idx) => ({
      id: `${sessionId}:${chunk.metadata.t_offset_ms}`,
      values: embeddings.data[idx],
      metadata: chunk.metadata
    }))
    
    await fetch(`https://api.cloudflare.com/client/v4/accounts/${ctx.accountId}/vectorize/v2/indexes/${ctx.vectorizeId}/upsert`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${ctx.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vectors })
    })
  }
}
```

### Query example

"Find sessions where cod was marked between 80-120 fathoms off Kodiak in July":

```typescript
// Workers AI does query expansion
const queryEmbedding = await env.AI.run('@cf/baai/bge-large-en-v1.5', {
  text: ["cod marked 80-120 fathoms"]
})

// Vectorize returns nearest + metadata filter
const results = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ctx.accountId}/vectorize/v2/indexes/${ctx.vectorizeId}/query`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${ctx.token}` },
  body: JSON.stringify({
    vector: queryEmbedding.data[0],
    topK: 20,
    filter: { 
      t_offset_ms: { $gte: ... },
      geo_polygon: { ... },
      vessel_id: ...
    },
    returnMetadata: 'all'
  })
})
```

**Note:** Vectorize has `metadata` filtering but **not** native geospatial operators. For point-in-region, we do coarse filtering on lat/lon ranges in `metadata`, then refine client-side. Acceptable for fishing use case (you're searching *your own* data, not the whole world).

---

## 7. Vessel Integration Layer

### Data sources on a commercial fishing boat

| Source | Protocol | Latency | Reliability |
|--------|----------|---------|-------------|
| **Boat GPS / chartplotter** | NMEA 0183/2000 → Signal K WebSocket | <1s | Excellent |
| **Depth sounder** (Furuno, Simrad, Garmin) | Ethernet / NMEA / proprietary | Variable | Good |
| **AIS** (other vessels) | NMEA 0183 via Signal K | 2-10s | Excellent |
| **Underwater camera** (GoPro, low-light) | USB/WiFi/file drop | Manual | Variable |
| **Wind, water temp** | NMEA via Signal K | <1s | Excellent |
| **Engine telemetry** (RPM, fuel) | NMEA 2000 / J1939 | <1s | Excellent |
| **Hydraulic / winch sensors** | Custom / NMEA 2000 | Variable | Variable |

### Integration architecture

```
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │  NMEA 0183   │  │  NMEA 2000   │  │  Camera      │
   │  (serial)    │  │  (CAN bus)   │  │  (USB/WiFi)  │
   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
          │                 │                 │
          └────────┬────────┴────────┬────────┘
                   │                 │
                   ▼                 ▼
            ┌─────────────────────────────┐
            │  Signal K Server            │
            │  (boat-mounted Pi/NUC)      │
            │  - parses NMEA              │
            │  - WebSocket on boat WiFi   │
            │  - REST API                 │
            └──────────────┬──────────────┘
                           │ ws://192.168.1.10:3000/signalk/v1/stream
                           │
                           ▼
            ┌─────────────────────────────┐
            │  ActiveLog Phone App        │
            │  - SignalK client           │
            │  - subscribes to paths      │
            │  - writes to IndexedDB      │
            │  - syncs when online        │
            └─────────────────────────────┘
```

### Subscription model

Signal K uses a path-based subscription model. The phone subscribes to specific paths:

```typescript
// lib/signalk/subscriptions.ts
const SUBSCRIPTIONS = [
  // Navigation
  'vessels.self.navigation.position',
  'vessels.self.navigation.speedOverGround',
  'vessels.self.navigation.headingTrue',
  'vessels.self.navigation.courseOverGroundTrue',
  
  // Environment  
  'vessels.self.environment.depth.belowKeel',
  'vessels.self.environment.depth.belowTransducer',
  'vessels.self.environment.wind.speedApparent',
  'vessels.self.environment.wind.angleApparent',
  'vessels.self.environment.water.temperature',
  
  // Engine (NMEA 2000 PGNs decoded by Signal K)
  'vessels.self.propulsion.engine.revolutions',
  'vessels.self.propulsion.engine.temperature',
  'vessels.self.tanks.fuel',
  
  // Sounder (varies by brand — often via plugin)
  'vessels.self.environment.depth.sounderImage'  // base64-encoded image if available
]

await signalk.subscribe(SUBSCRIPTIONS, handler)
```

### Sounder image capture

This is the hard one. Sounder brands have wildly different output:

| Brand | Data path | Format |
|-------|-----------|--------|
| **Furuno NavNet** | Proprietary | Screen capture (HDMI + capture card) |
| **Garmin Fantom** | NMEA 2000 PGN | Not directly; needs their SDK |
| **Simrad NSS** | Ethernet (NMEA 2000 + proprietary) | Partial via Signal K plugin |
| **Generic fishfinder** | Composite video out | Screen capture |

**Pragmatic recommendation:**
1. **Best case:** HDMI capture card + Signal K plugin that timecodes the image → uploads to R2
2. **Acceptable:** Screen capture on a tablet that's mirroring the sounder display → timestamp + upload
3. **Cheapest:** Photograph the sounder screen with phone camera (low-fi but timestamped, trainable)

### Underwater camera

```typescript
// Camera integration: simplest possible
async function importCameraFootage(sessionId: string, files: FileList) {
  for (const file of files) {
    // User drops video files (from GoPro SD card or direct WiFi transfer)
    const r2Key = `sessions/${sessionId}/camera/${file.name}`
    await uploadToR2(r2Key, file)
    await db.add('media_blobs', {
      session_id: sessionId,
      t_offset_ms: inferOffsetFromFilename(file.name),  // e.g., GOPRO_001.MP4 → t=0
      kind: 'camera_underwater',
      r2_key: r2Key,
      duration_ms: await getVideoDuration(file)
    })
  }
}
```

### Alignment problem

Everything is aligned by **`t_offset_ms` from session start**. The session starts when the user taps "Start Session". All sources use this single timestamp base.

For sources that come in pre-aligned (camera files with their own timecode), we use the camera's start time as a hint and ask the user to confirm the offset.

---

## 8. The Supervised Learning Loop

### The training corpus

Every session produces a **triplet**:

```
(session_id, t_offset_ms) →
  - transcript_chunk   (text + audio in R2)
  - sounder_image      (PNG/JPEG in R2)
  - camera_frame       (image or video segment in R2)
  - vessel_telemetry   (depth, position, speed, heading)
  - annotation_label   (e.g., "cod school 110-130m on rocky bottom")
```

### Training data format

We export as **WebDataset** or **TFRecord** — formats ML frameworks understand:

```
session-export/
├── metadata.jsonl                  # one row per sample
├── sounder/
│   ├── sample_0001.tar
│   ├── sample_0002.tar
│   └── ...
├── camera/
│   ├── sample_0001.tar
│   └── ...
└── transcript/
    ├── sample_0001.txt
    └── ...
```

`metadata.jsonl` looks like:

```json
{"id": "01HXYZ:00500", "session_id": "01HXYZ", "t_offset_ms": 500000, "lat": 58.234, "lon": -152.456, "depth_m": 142, "label": "cod_school", "species": "gadus_macrocephalus", "depth_range_m": [110, 130], "transcript": "Mark — possible cod school at 110-130m..."}
{"id": "01HXYZ:00600", "session_id": "01HXYZ", "t_offset_ms": 600000, "lat": 58.235, "lon": -152.455, "depth_m": 144, "label": "rocky_bottom", "transcript": "Hard bottom, scattered boulders..."}
```

### Annotation UI

Critical UX. Captain shouldn't have to type during a set:

```
┌─────────────────────────────────────────────────────────────┐
│  Quick Tag  (hold button to record audio, release to tag)   │
│                                                             │
│   [🎣 Cod]   [🐟 Halibut]   [🪨 Bottom Type]   [🌊 Cond.]   │
│                                                             │
│   Custom label: [____________________]                      │
│                                                             │
│   Depth (auto): 142 m    Speed: 6.2 kts   Heading: 087°     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Each tap creates an annotation row in IndexedDB. Long-press starts audio recording that gets transcribed and attached to the annotation. Tag is associated with current `t_offset_ms`, current GPS, current depth.

### Sounder analyzer training pipeline

**Goal:** Given a sounder image (or 1D sounder return over time), predict fish presence, species, and size.

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│ Sounder images │     │ Annotations    │     │ Vessel data    │
│ (R2)           │     │ (D1 / JSONL)  │     │ (D1 / SignalK) │
└────────┬───────┘     └────────┬───────┘     └────────┬───────┘
         │                      │                      │
         └──────────┬───────────┴──────────────────────┘
                    │
                    ▼
         ┌────────────────────────────────┐
         │  Training data builder         │
         │  (Cloudflare Worker, scheduled)│
         │                                │
         │  - joins by (session, t_offset)│
         │  - crops sounder to annotation │
         │    window                      │
         │  - exports as WebDataset tar   │
         │  - uploads to R2               │
         └────────────┬───────────────────┘
                      │
                      ▼
         ┌────────────────────────────────┐
         │  Training job                  │
         │  (run externally:               │
         │   - Modal / Replicate / local) │
         │                                │
         │  Model: small CNN or ViT       │
         │  Input: sounder crop           │
         │  Output: species + bbox + depth│
         └────────────────────────────────┘
```

**Why not train on Cloudflare?** Workers + Workers AI are inference-only. Training needs GPUs (Modal, Replicate, Lambda Labs are the picks). We just produce the data; the user runs training wherever they want.

### Active learning loop

Once the model is trained, deploy it back to the boat:

```
1. Model trained on 100 sessions
2. Model deployed to boat tablet (local inference, ONNX/TFLite)
3. Model runs on sounder feed in real-time
4. Model proposes annotations: "I think that's cod at 115m"
5. Captain confirms/rejects on phone → new training signal
6. New data uploaded on next sync
7. Model retrained weekly/monthly
```

This is the **real value** of ActiveLog. The transcript is the data collection interface; the trained model is the **product**.

---

## Appendix A: Tech Stack Summary

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | **Cloudflare Pages** + Vite + React | Fast, free, edge-cacheable |
| App shell | PWA (Capacitor wrapper for iOS/Android later) | Offline-first |
| Storage (local) | **IndexedDB** (Dexie.js) + File System Access API | Survives offline |
| Sync API | **Cloudflare Worker** (our account) | Stateless, scales |
| Auth | Custom (token-based) + Clerk (Tier 2) | No CF account required for Tier 1 |
| Transcription | Web Speech API + Workers AI Whisper | Dual-track, offline-capable |
| Embeddings | `@cf/baai/bge-large-en-v1.5` | Quality |
| Vector DB | **Vectorize** (per-user) | Serverless, scales |
| Relational DB | **D1** (per-user) | SQLite, cheap, serverless |
| Object storage | **R2** (per-user, optional) | Holds audio/video/sounder images |
| Background sync | Service Worker + Background Sync API | Offline queue |
| Real-time boat data | Signal K WebSocket | Open standard |

## Appendix B: File / Resource Summary

| Resource | Tier 1 | Tier 2 | Tier 3 |
|----------|--------|--------|--------|
| Local markdown | ✅ | ✅ | ✅ |
| IndexedDB | ✅ | ✅ | ✅ |
| Cloudflare account | ❌ | ✅ (ours, multi-tenant) | ✅ (theirs) |
| D1 | ❌ | ✅ (shared, namespaced) | ✅ (theirs) |
| Vectorize | ❌ | ✅ (shared, namespaced) | ✅ (theirs) |
| R2 | ❌ | ✅ (shared bucket, prefix) | ✅ (theirs) |
| Workers AI (Whisper) | ❌ (Web Speech only) | ✅ | ✅ |
| Workers AI (embeddings) | ❌ | ✅ | ✅ |

## Appendix C: Open Questions for Casey

1. **Trip duration typical?** Days? Weeks? Drives Capacitor vs PWA decision.
2. **Boat WiFi availability?** Affects whether Signal K is reachable for real-time vs uploaded post-trip.
3. **What sounder brand/model?** Drives the sounder image capture path.
4. **Do you have Signal K installed?** If not, we ship a Pi image.
5. **Crew size?** Multi-crew sessions need conflict resolution (multiple devices).
6. **Languages?** Crew English-only or multilingual? Affects Whisper model + chunking.
7. **Regulatory?** Any reason to keep data in a specific jurisdiction? (R2 has regions.)
8. **Multi-vessel?** Are sessions tagged per-vessel, and do you want cross-vessel search?

---

**Next steps:** Build a thin slice end-to-end:
1. Cloudflare Pages + React PWA shell
2. Web Speech transcription loop
3. IndexedDB session storage
4. Markdown export
5. Cloudflare Worker + D1 sync endpoint (single endpoint, no auth yet)

Get that on a boat for one trip. Validate the offline-first model. Then add Whisper sync, Vectorize, and Signal K.
