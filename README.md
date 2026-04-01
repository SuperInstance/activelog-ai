# ActiveLog.ai

> Privacy-first AI fitness companion. Built on log-origin. Cloudflare-native, forkable, yours.

## What Is This

ActiveLog.ai is a themed fitness vessel built on [log-origin](https://github.com/CedarBeach2019/log-origin) — an AI fitness coach that tracks workouts, nutrition, recovery, and progress with a smart training planner.

**The core idea:** Every workout builds a log. The log trains the coach. The coach gets better. Your fitness has a memory.

## Features

- **Workout Logger** — Log strength, cardio, HIIT, flexibility, and sports sessions with exercises, sets, reps, weight, and RPE
- **Nutrition Tracker** — Track meals, macros (protein/carbs/fat), calories, and water intake with daily summaries
- **Recovery Dashboard** — Monitor sleep, soreness, energy, mood; get recovery scores and readiness badges
- **Progress Charts** — Weekly volume, strength progression by exercise, body weight/body fat tracking
- **Fitness Coach Chat** — AI-powered coaching via the log-origin chat pipeline
- **Workout Planner** — Periodized training plans (foundation → volume → intensity → peak → deload)
- **Progressive Overload** — Automatic weight/rep increase suggestions based on training history
- **Streak Tracker** — Current and longest workout streaks, weekly goal progress
- **Deload Detection** — Fatigue analysis from recovery data, training streak, and RPE trends

## Architecture

```
src/fitness/
  tracker.ts    — WorkoutLog, NutritionLog, RecoveryTracker, ProgressiveOverload, StreakTracker
  planner.ts    — WorkoutPlanner, Periodization, DeloadDetector
worker/routes/
  fitness.ts    — /api/workouts, /api/nutrition, /api/recovery, /api/progress
public/
  app.html      — Dark athletic UI (charcoal #1F2937, electric green #10B981)
```

## Status

🚧 **Active Development** — Fitness vessel on log-origin. Architecture docs in `docs/`.

## Design Documents

| Document | What It Covers |
|----------|---------------|
| [Platform Vision](docs/PLATFORM-VISION.md) | The big picture: LOG.ai concept, domains as hubs, omni-bot, flywheel |
| [Master Plan](docs/MASTER-PLAN.md) | 7-phase roadmap, architecture overview, privacy model |
| [Database Schema](docs/database/SCHEMA-DESIGN.md) | Every table, column, index, migration strategy, D1 constraints |
| [Intelligence Design](docs/routing/INTELLIGENCE-DESIGN.md) | Routing, classification, adaptive learning, draft rounds, agent routing |
| [Security Model](docs/security/SECURITY-MODEL.md) | 17-threat matrix, auth, authorization, API security, Worker security |
| [Privacy Architecture](docs/privacy/PRIVACY-ARCHITECTURE.md) | Encryption flows, PII detection, zero-knowledge analysis, compliance |
| [API Design](docs/api/API-DESIGN.md) | Every endpoint, request/response schemas, streaming, error handling |
| [Protocol Spec](docs/api/PROTOCOL-SPEC.md) | MCP integration, agent communication, local tunnels, federation |
| [UX Design](docs/ux/UX-DESIGN.md) | Personas, wireframes, theming, accessibility, information architecture |
| [Component Spec](docs/ux/COMPONENT-SPEC.md) | Preact components, state management, streaming, performance |
| [Initial Design](docs/architecture/initial-design.md) | Original design from the research phase |

## Design Documents

| Document | What It Covers |
|----------|---------------|
| [Platform Vision](docs/PLATFORM-VISION.md) | The big picture: LOG.ai concept, domains as hubs, omni-bot, flywheel |
| [Master Plan](docs/MASTER-PLAN.md) | 7-phase roadmap, architecture overview, privacy model |
| [Database Schema](docs/database/SCHEMA-DESIGN.md) | Every table, column, index, migration strategy, D1 constraints |
| [Intelligence Design](docs/routing/INTELLIGENCE-DESIGN.md) | Routing, classification, adaptive learning, draft rounds, agent routing |
| [Security Model](docs/security/SECURITY-MODEL.md) | 17-threat matrix, auth, authorization, API security, Worker security |
| [Privacy Architecture](docs/privacy/PRIVACY-ARCHITECTURE.md) | Encryption flows, PII detection, zero-knowledge analysis, compliance |
| [API Design](docs/api/API-DESIGN.md) | Every endpoint, request/response schemas, streaming, error handling |
| [Protocol Spec](docs/api/PROTOCOL-SPEC.md) | MCP integration, agent communication, local tunnels, federation |
| [UX Design](docs/ux/UX-DESIGN.md) | Personas, wireframes, theming, accessibility, information architecture |
| [Component Spec](docs/ux/COMPONENT-SPEC.md) | Preact components, state management, streaming, performance |
| [Initial Design](docs/architecture/initial-design.md) | Original design from the research phase |

## Key Design Decisions

- **Cloudflare Workers** — edge deployment, $0 on free tier, scale to zero
- **D1 (SQLite)** — our current Python prototype uses SQLite, D1 ports directly
- **Preact** — 4KB, no build step, ships as static Worker assets
- **Hono** — typed HTTP framework for Workers
- **Client-side encryption** — AES-256-GCM, PBKDF2 key derivation, zero-knowledge at rest
- **Regex-first routing** — 5ms classification on Workers, ML optimizes rules over time
- **OpenAI-compatible API** — drop-in replacement for existing SDKs

## Themed Forks

log-origin is the engine. Themed forks add personality:

- **ActiveLog.ai** — AI fitness companion with workout tracking, nutrition, and recovery (this vessel)
- **DMlog.ai** — TTRPG world-builder's AI
- **studylog.ai** — AI tutor that remembers what you've learned
- **makerlog.ai** — AI pair programmer that learns your style
- **businesslog.ai** — AI assistant for operations and analytics

Each fork customizes: system prompts, UI theme, routing rules, and feature set.

## Research

See `.research/` for the raw research that informed the design:

- `cloudflare-arch.md` — Cloudflare services, limits, pricing
- `privacy-vault.md` — Encryption research, threat model
- `agent-tunnels.md` — Cloudflare Tunnel, MCP, A2A protocols
- `forkable-repo.md` — Fork patterns, update mechanism, personality packs
- `log-platform.md` — LOG.ai brand concept, omni-bot design
- `multi-tenant.md` — Workers for Platforms, scaling tiers
- `agent-network.md` — Agent identity, discovery, communication

## License

MIT
