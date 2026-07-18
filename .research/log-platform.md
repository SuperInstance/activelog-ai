# LOG.ai Platform — Deep Research Journey

*Started: 2025-03-25 | Status: Living Document*

---

## 1. What is "LOG"?

### The Core Metaphor: **Your AI Keeps a Ledger of You**

LOG isn't "logging" in the sysadmin sense. It's **the ship's logbook** — the record of a voyage. Every interaction is a log entry. Over time, these entries form a narrative of who you are, what you're building, what you're learning.

The word works on every level:

| Layer | Meaning | LOG.ai Application |
|-------|---------|-------------------|
| **Nautical** | Ship's logbook — record of a journey | Your AI journey, documented and navigable |
| **Computing** | Event log — structured record of what happened | Every conversation, task, and decision, queryable |
| **Ledger** | Financial record — who owes what, what's been earned | Knowledge debt repaid, skills accumulated, progress tracked |
| **Mathematics** | Logarithm — exponential growth made linear, scalable | Your growth as a human, made visible and compounding |
| **Timber** | A log — raw material to build with | Raw experiences become the building material of your AI |

### The Tagline

> **LOG.ai — Your journey, recorded. Your AI, evolved.**

### Why It Works

- It's not "chat.ai" or "assistant.ai" — those are *interaction* words. LOG is a *persistence* word.
- The .ai TLD makes it "AI that keeps a log" — the AI is the persistent layer.
- Subdomains become natural: `you.studylog.ai` = "your study log, powered by AI"
- It implies **continuity** — a log isn't ephemeral. It's a record. It outlasts the session.

### The Deeper Insight

LOG flips the standard AI metaphor. Most AI products are "ask a question, get an answer, forget." LOG is: **every interaction adds to a persistent record that makes every future interaction better.** The AI isn't stateless. It's stateful by design. It *remembers* because it *logs*.

This is the differentiator. Not model quality — every platform will have good models. **Memory continuity** is what makes LOG valuable.

---

## 2. The Omni-Bot: One Face, Many Minds

### Architecture

```
┌─────────────────────────────────────────────────┐
│              user.studylog.ai                    │
│  ┌───────────────────────────────────────────┐  │
│  │           OMNI-BOT (Router)               │  │
│  │  - Classifies intent                      │  │
│  │  - Routes to appropriate agent            │  │
│  │  - Synthesizes responses                  │  │
│  │  - Maintains conversation continuity      │  │
│  └────────┬────────┬────────┬────────┬────────┘  │
│           │        │        │        │           │
│     ┌─────▼──┐ ┌──▼─────┐ ┌▼──────┐ ┌▼──────┐  │
│     │Tutor   │ │Research│ │Quiz   │ │Schedule│  │
│     │Agent   │ │Agent   │ │Agent  │ │Agent   │  │
│     └────────┘ └────────┘ └───────┘ └────────┘  │
│         ↕          ↕          ↕         ↕        │
│     ┌────────────────────────────────────────┐   │
│     │           LOG LAYER (Memory)            │   │
│     │  - All agent interactions logged        │   │
│     │  - Cross-agent context sharing          │   │
│     │  - User preferences & history           │   │
│     └────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### The User Perception

The user sees ONE chat interface. They type: "Help me understand quantum entanglement and then quiz me on it."

What happens internally:
1. **Omni-Bot** parses this as a two-step task
2. Routes step 1 to **Tutor Agent** (specialized in explanation)
3. Tutor Agent explains, logs its response to the LOG LAYER
4. Omni-Bot signals completion of step 1
5. Routes step 2 to **Quiz Agent** (which already has the Tutor's explanation in LOG)
6. Quiz Agent generates questions based on what was taught
7. Omni-Bot presents everything as a seamless conversation

**The user never sees routing.** They see one assistant that "gets smarter" because it has specialized sub-minds.

### Compare Agents, Not Just Models

This is the key insight: the draft comparison tool shouldn't just pit GPT-4 vs Claude. It should let you compare **agents** — different configurations, skill sets, routing strategies:

```
┌─────────────────────────────────┐
│     AGENT COMPARISON            │
│                                 │
│  Input: "Explain recursion"     │
│                                 │
│  ┌───────────┐ ┌──────────────┐ │
│  │ Agent A   │ │ Agent B      │ │
│  │ TutorBot  │ │ ResearchBot  │ │
│  │ GPT-4o    │ │ Claude 3.5   │ │
│  │ + quiz    │ │ + citations  │ │
│  │ skills    │ │ skills       │ │
│  │           │ │              │ │
│  │ "Here's   │ │ "Recursion  │ │
│  │  a simple │ │  was first  │ │
│  │  analogy  │ │  formalized │ │
│  │  ..."     │ │  in 1936 by │ │
│  │           │ │  Kleene..." │ │
│  └───────────┘ └──────────────┘ │
│                                 │
│  [Pick A] [Pick B] [Merge]     │
└─────────────────────────────────┘
```

### Is Omni-Bot a Meta-Agent?

**Yes.** The Omni-Bot is a routing/synthesis agent. It doesn't do the work — it orchestrates. Think of it as the prefrontal cortex: it doesn't process visual input (that's the visual cortex / specialist agent), but it coordinates which part of the brain handles what.

Implementation:
- Classification model (small, fast) → intent detection
- Routing rules (configurable by user) → which agent handles what
- Synthesis step → merging multi-agent responses into coherent output
- The routing rules themselves live in the user's repo (editable, versionable)

---

## 3. Two-Repo Architecture

### The Model

```
user.studylog.ai/
├── Public Repo (GitHub, open/visible)
│   ├── agents/          # Shared agent configs
│   ├── skills/          # Reusable skill packages
│   ├── personas/        # Community personas
│   └── README.md        # "This is my study setup"
│
└── Private Repo (Git, encrypted/private)
    ├── data/
    │   ├── conversations/  # Chat history
    │   ├── preferences.json
    │   └── knowledge/      # Personal knowledge base
    ├── models/
    │   └── fine-tuned/     # Personal fine-tunes
    ├── secrets/
    │   └── api-keys.enc
    └── .private-skills/    # Personal-only skills
```

### How They Interact

The private repo **imports** from the public repo via Git submodules or simple file references:

```yaml
# private-repo/config.yaml
imports:
  - repo: github.com/user31/studylog-public
    agents: [tutor, quiz, research]
    skills: [citation, flashcard, summarizer]
  - repo: github.com/community/math-skills
    skills: [latex-renderer, equation-solver]
```

The runtime resolves these imports at deploy time. Private repo overrides win.

### Sharing With Friends

Technical options, ranked by simplicity:

1. **Git-based (simplest)**: Add friend as collaborator to private repo. They clone, deploy their own instance with your config + their private data. Think "fork my AI setup."

2. **Token-based access**: Your instance issues scoped tokens. Friend's omni-bot connects via A2A protocol with those tokens.
   ```
   Friend's Agent ──[A2A + scoped token]──→ Your Agent
   Permissions: read knowledge base, cannot write, cannot see secrets
   ```

3. **Cloudflare Access policy**: Whitelist friend's subdomain. They access your instance directly.

### A2A Between Users

This is the visionary part: **agents talking to agents.**

```
┌──────────────────┐         ┌──────────────────┐
│  user31.studylog │         │  user66.studylog │
│  ┌────────────┐  │         │  ┌────────────┐  │
│  │ Omni-Bot   │◄─┼──A2A───┼─►│ Omni-Bot   │  │
│  └────────────┘  │         │  └────────────┘  │
│  "Hey, user66    │         │  "user31 shared  │
│   shared notes   │         │   their study    │
│   on chapter 5"  │         │   notes with me" │
└──────────────────┘         └──────────────────┘
```

Use cases:
- Study group: share flashcard decks between instances
- Collaborative building: makerlog instances share project state
- Accountability: activelog instances share fitness goals with a partner
- Family: reallog instances coordinate schedules

---

## 4. Multi-Repo Network

### Why Separate Repos?

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  work.ai    │  │ personal.ai │  │ hobby.ai    │
│  - Slack    │  │ - Calendar  │  │ - 3D print  │
│  - Jira     │  │ - Health    │  │ - Recipes   │
│  - Email    │  │ - Family    │  │ - Music     │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
                  ┌─────▼──────┐
                  │  SHARED    │
                  │  LOG LAYER │
                  │  (common   │
                  │   memory)  │
                  └────────────┘
```

Benefits of separation:
1. **Context isolation** — Work agent doesn't accidentally reference your personal health data
2. **Different access controls** — Share work repo with colleagues, personal stays private
3. **Different routing rules** — Work repo routes to Jira/Slack agents; personal routes to calendar/health
4. **Independent scaling** — Hobby repo can run on a $5 VPS; work repo might need more
5. **Clean failure boundaries** — If hobby repo goes down, work AI still works
6. **Different themes/domains** — Each repo gets its own themed UI

### Cross-Repo Discovery

Each repo publishes a **manifest** (like a `.well-known` for agents):

```yaml
# .well-known/log-manifest.yaml
domain: work.casey.ai
agents:
  - name: jira-assistant
    capabilities: [issue-management, sprint-planning]
    endpoint: /api/agents/jira
  - name: slack-summarizer
    capabilities: [meeting-notes, thread-summary]
    endpoint: /api/agents/slack
cross-repo:
  allows: [personal.casey.ai, family.casey.ai]
  shared-agents: [calendar-sync]
```

One repo's routing rules can reference another:

```yaml
# personal.casey.ai routing rules
routes:
  - intent: work-related
    forward-to: work.casey.ai
    agents: [jira-assistant]
```

---

## 5. Cloud + Local Agent Mix

### The Architecture

```
┌────────────────────────────────────────────┐
│              CLOUD (always-on)             │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐  │
│  │ Omni-Bot │ │ Router   │ │ Fallback  │  │
│  │ (thin)   │ │ Rules    │ │ Agent     │  │
│  └────┬─────┘ └──────────┘ └───────────┘  │
│       │                                     │
│  ┌────▼──────────────────────────────┐     │
│  │  Cloudflare Tunnel (cf tunnel)     │     │
│  │  or Tailscale Funnel              │     │
│  └───────────────────────────────────┘     │
└──────────────────┬─────────────────────────┘
                   │
         ┌─────────┼─────────┐
         │         │         │
    ┌────▼────┐ ┌─▼─────┐ ┌▼──────┐
    │ Laptop  │ │Jetson │ │ Server│
    │ OpenClaw│ │OpenClaw│ │OpenClaw│
    │ Local   │ │ Local  │ │ Local │
    │ Agent   │ │ Agent  │ │ Agent │
    └─────────┘ └───────┘ └───────┘
```

### Routing Logic

The omni-bot's routing rules include **presence checks**:

```yaml
routes:
  - intent: browse-web
    agent: manus-cloud          # Always cloud
    fallback: null
    
  - intent: control-local-hardware
    agent: jetson-local          # Requires local
    fallback: claude-cloud       # "Your Jetson is offline; I'll use cloud instead"
    fallback-message: "⚠️ Your home server is offline. Using cloud fallback. Some features limited."
    
  - intent: analyze-private-docs
    agent: laptop-local          # Privacy-sensitive → local
    fallback: refuse             # Don't send private docs to cloud
    fallback-message: "🔒 Your laptop is offline. Refusing to process private documents in cloud. Try again when your laptop is connected."
```

### Authentication: Cloud ↔ Local

```
Cloud Omni-Bot ──[mTLS over Tailscale]──→ Local OpenClaw
                 or
Cloud Omni-Bot ──[Cloudflare Tunnel + JWT]──→ Local OpenClaw
```

- **Tailscale**: Zero-config, mutual TLS, works through NAT. Each local agent has a Tailscale identity.
- **Cloudflare Tunnel**: User runs `cloudflared tunnel` on local machine. Cloud routes to it. JWT for auth.
- Both support offline detection via heartbeat/health check.

### Offline Handling Strategy

```
                    Request arrives
                         │
                    ┌────▼────┐
                    │ Health  │
                    │ Check   │
                    └──┬──┬───┘
                  online│  │offline
                      │  │
               ┌──────▼  ▼──────┐
               │                  │
        Route to          Check fallback rules:
        local agent       - cloud substitute?
                          - queue for later?
                          - refuse gracefully?
```

---

## 6. Structuring Ongoing Research

### The Format: Living Journey Document

This document (JOURNEY.md) IS the format. Structure:

```markdown
# JOURNEY.md — Living Research Document

## Status
- Last updated: [date]
- Phase: [concept → design → build → ship]
- Decisions made: [link to DECISIONS.md]
- Open questions: [number]

## Findings (with dates)
### 2025-03-25 — Initial deep think
- Core LOG metaphor defined
- Omni-bot architecture sketched
- ...

## Decisions Log
### DECISION-001: LOG means "ledger of your journey"
- Date: 2025-03-25
- Rationale: [link to section 1]
- Status: PROPOSED → ACCEPTED / REJECTED

## Open Questions
- [ ] How to handle data portability between repos?
- [ ] What's the pricing model for cloud agents?
- [ ] ...

## Gold (Distilled Insights)
> One-liners worth keeping, extracted from long analysis.
> - "LOG is persistence, not interaction."
> - "Compare agents, not models."
```

### Supporting Files

```
.research/log-platform/
├── JOURNEY.md          ← This document (narrative + decisions)
├── DECISIONS.md        ← Formal decision log (ADR style)
├── ARCHITECTURE.md     ← Technical architecture deep-dive
├── USER-FLOWS.md       ← Concrete user experience walkthroughs
├── QUESTIONS.md        ← Open questions, ranked by priority
└── diagrams/
    ├── omni-bot.svg
    ├── two-repo.svg
    ├── cloud-local.svg
    └── multi-repo.svg
```

---

## 7. User Experience Walkthroughs

### Experience 1: Sarah, Medical Student

```
Sarah opens sarah.studylog.ai on her tablet at 7 AM.

Sarah: "What did I study yesterday?"
Omni-Bot: [checks LOG LAYER] "You reviewed cardiovascular pharmacology for 
          90 minutes. You got 78% on the practice quiz. Want to review the 
          questions you missed?"

Sarah: "Yes, and make flashcards for the ones I got wrong."

[Omni-Bot routes to Quiz Agent → retrieves missed questions]
[Omni-Bot routes to Flashcard Agent → creates cards]
[Both logged to LOG LAYER]

Omni-Bot: "Created 12 flashcards from your missed questions. They've been 
          added to your deck. Want to review now or after breakfast?"
```

The magic: Sarah didn't specify which agents. The omni-bot figured it out. Everything is logged. Tomorrow, it'll know what she reviewed today.

### Experience 2: Marcus, Maker

```
Marcus: [pushes code to GitHub]
His makerlog.ai instance detects the webhook.

Omni-Bot: "Nice, v2.3 pushed to main. I notice the PR had 3 review comments 
          about the API schema. Want me to draft responses?"
          
Marcus: "Yeah, use my usual style."

[Omni-Bot checks LOG LAYER → finds Marcus's communication style profile]
[Routes to Code Agent → analyzes PR comments + code]
[Routes to Writing Agent → drafts responses in Marcus's voice]

Omni-Bot: "Drafted 3 responses. [shows previews] Want to post them or edit first?"
```

### Experience 3: Casey, Power User (Multi-Repo)

```
Casey types in work.casey.ai: "Remind me of what I discussed with the team 
about the LOG.ai branding."

[Omni-Bot checks work LOG → finds meeting notes from 2 days ago]
[Cross-references personal.casey.ai LOG → finds related personal brainstorm]

Omni-Bot: "In your team meeting Tuesday, you discussed:
          1. LOG as 'persistence not interaction'
          2. The ship's logbook metaphor
          3. Comparing agents, not models
          
          I also found a related brainstorm in your personal notes where you 
          expanded on the logarithm connection. Want me to merge these?"
```

---

## Open Questions (Priority Order)

1. **Data ownership** — Where does the LOG data live? User's cloud storage? Encrypted on server? Local-first with cloud sync?
2. **Monetization** — Freemium? Per-agent pricing? Subdomain hosting fees?
3. **Interoperability** — Can a studylog.ai user talk to a makerlog.ai user's agent?
4. **Onboarding** — How do non-technical users set up their subdomain and agents?
5. **Agent marketplace** — Can users share/sell agent configurations?
6. **Privacy model** — GDPR? Right to be forgotten? What happens to logs on account deletion?
7. **Offline-first** — How much should work without internet?

---

*"The best AI assistant isn't the one that gives the best answer — it's the one that remembers your last thousand questions and makes the next answer better."*
