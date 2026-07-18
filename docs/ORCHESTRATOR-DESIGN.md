# Director Orchestrator Design

> Multi-agent orchestration for DMlog.ai (TTRPG) and StudyLog.ai (interactive learning).
> Date: 2026-03-26

---

## Table of Contents

1. [Director Agent Design](#1-director-agent-design)
2. [Agent Registry](#2-agent-registry)
3. [Agent Communication Protocol](#3-agent-communication-protocol)
4. [Session State Machine](#4-session-state-machine)
5. [Implementation on Cloudflare Workers](#5-implementation-on-cloudflare-workers)
6. [Multi-Player Support](#6-multi-player-support)
7. [Cost Optimization](#7-cost-optimization)
8. [Devil's Advocate](#8-devils-advocate)
9. [TypeScript Interfaces](#9-typescript-interfaces)

---

## 1. Director Agent Design

The Director is a meta-agent that never speaks to the user directly. It decides *who* speaks, *what* they do, and *when* the session transitions between phases. Inspired by OpenMAIC's director graph pattern, adapted for stateless Cloudflare Workers execution.

### 1.1 Director System Prompt Structure

```markdown
You are the Session Director for a {domain} session ({sessionType}).

## Your Role
You NEVER speak to users. You decide which agent handles the current turn.
Output ONLY a JSON decision object.

## Current Session State
- Phase: {phase}
- Turn: {turnNumber}
- Active agents: {agentList}
- Players: {playerList}
- Last speaker: {lastSpeakerId}
- Recent summary: {contextSummary}

## Decision Criteria
1. **Phase appropriateness** — which agents are valid in the current phase?
2. **Narrative/logical flow** — what should happen next to advance the session?
3. **Player intent** — what is the user trying to accomplish?
4. **Balance** — has any agent been silent too long? Is an NPC waiting to act?
5. **Pacing** — is the session dragging? Should we speed up or slow down?

## Output Format
Respond with a single JSON object:
{
  "agentId": "...",
  "instructions": "...",
  "phaseTransition": null | { "to": "...", "reason": "..." },
  "shouldEnd": false,
  "priority": "normal" | "high" | "low",
  "reasoning": "..."
}
```

### 1.2 Decision Framework

The Director considers these inputs per turn:

| Input | Source | Weight |
|-------|--------|--------|
| Current phase + valid transitions | Session state (D1) | High |
| Player message content + intent | Incoming request | High |
| Conversation history (summarized) | KV / D1 | Medium |
| Active agent list + personalities | Session config | Medium |
| Turn count + phase duration | Computed | Medium |
| Player metadata (level, preferences) | User profile | Low |
| World state / learning progress | Domain state | Low |

### 1.3 Director Delegation Flow

```
User Message
    │
    ▼
┌──────────────────┐
│  Load Session    │ ← D1 + KV (phase, history, agent states)
│  State           │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Director LLM    │ ← Single LLM call (~500 tokens in, ~150 out)
│  Decision        │
└────────┬─────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────────┐
│ Phase  │ │ Dispatch to  │
│ Change?│ │ Content Agent│
│ (D1)   │ │ (LLM call)   │
└────────┘ └──────┬───────┘
                  │
                  ▼
           ┌──────────────┐
           │ Agent Output  │ → SSE stream to client
           │ (structured)  │
           └──────────────┘
```

### 1.4 Handling Multiple Simultaneous Inputs

In multi-player scenarios, the Director batches messages within a turn window (500ms debounce):

1. Collect all player messages in the window
2. Pass all messages to Director in a single decision
3. Director can: (a) pick one player to respond to, (b) dispatch multiple agents simultaneously, (c) request clarification
4. If two players request conflicting actions, Director resolves using game/learning logic

### 1.5 Interrupt Handling

The Director recognizes interrupts when:
- Player message has high urgency markers (exclamation, OOC commands, `/ooc`)
- Player explicitly requests interrupt (`"Wait—"`, `"Stop"`, `"/pause"`)
- System event triggers (timeout, error, external signal)

On interrupt: Director can force phase transition, reset turn order, or queue the interrupt for next available slot.

---

## 2. Agent Registry

### 2.1 DMlog.ai Agents

| Agent ID | Role | LLM? | Actions |
|----------|------|------|---------|
| `dungeon_master` | Main narrator, rules arbiter, scene controller | Yes | `narrate`, `scene_change`, `describe`, `rule_check`, `combat_start`, `combat_end` |
| `npc_{id}` | Dynamic NPCs with personality, knowledge, secrets | Yes | `speak`, `react`, `attack`, `flee`, `trade`, `quest_give` |
| `combat_engine` | Initiative tracking, attacks, saves, damage | No (deterministic) | `roll_initiative`, `resolve_attack`, `apply_damage`, `check_condition` |
| `lore_keeper` | World consistency, canon, established facts | Yes (cheap) | `fact_check`, `suggest_retcon`, `track_state` |
| `scene_builder` | Location descriptions, atmosphere, sensory detail | Yes | `describe_location`, `set_atmosphere`, `ambience` |
| `dice_roller` | Dice rolling (pure logic) | No | `roll`, `roll_with_modifier`, `roll_pool` |

### 2.2 StudyLog.ai Agents

| Agent ID | Role | LLM? | Actions |
|----------|------|------|---------|
| `teacher` | Main instructor, content delivery, questioning | Yes | `lecture`, `explain`, `ask_question`, `demonstrate`, `summarize` |
| `classmate` | Peer student, asks clarifying questions, makes mistakes | Yes | `ask_question`, `guess`, `confuse`, `agree`, `disagree` |
| `quiz_master` | Assessment generation and scoring | Yes | `generate_question`, `score_answer`, `give_feedback`, `adjust_difficulty` |
| `tutor` | One-on-one hints, Socratic questioning | Yes | `hint`, `socratic_question`, `explain_concept`, `break_down` |
| `progress_tracker` | Learning progress, spaced repetition scheduling | No (deterministic) | `update_progress`, `schedule_review`, `calculate_mastery` |

### 2.3 Agent Lifecycle

Agents are created when:
- A session starts (DM, teacher always present)
- An NPC is introduced (DMLog)
- A study module activates a co-agent (StudyLog)

Agents are destroyed when:
- The session ends
- An NPC leaves the scene (can be re-instantiated with memory from lore_keeper)

---

## 3. Agent Communication Protocol

### 3.1 Architecture: Message Passing + Shared State

Agents do **not** communicate directly. All communication flows through the Director via shared state.

```
┌─────────┐     instruction      ┌──────────┐     result      ┌──────────┐
│Director │ ──────────────────→  │ Agent A  │ ──────────────→ │Director  │
│         │ ←──────────────────  │          │ ←────────────── │          │
└─────────┘     agent_output     └──────────┘    instruction  └──────────┘
     │                                                                  │
     │                    ┌──────────┐                                  │
     └── instruction ──→ │ Agent B  │ ── result ────────────────────────┘
                          │          │
                          └──────────┘
```

### 3.2 Shared State (D1 + KV)

| Store | Content | Access |
|-------|---------|--------|
| D1 `session_states` | Phase, turn number, player list, agent list | Director reads/writes |
| D1 `world_state` | TTRPG: locations, NPCs, items, events. Study: topics, scores, mastery | All agents read, Director writes |
| KV `session:{id}:context` | Summarized conversation history (rolling window) | Director reads, agents read |
| KV `session:{id}:agent:{id}:memory` | Per-agent working memory, last instructions | Director + that agent |

### 3.3 Director → Content Agent Instructions

```typescript
interface AgentInstruction {
  sessionId: string;
  agentId: string;
  turnNumber: number;
  phase: SessionPhase;
  playerMessage?: string;           // Original player input
  contextSummary: string;           // Last N turns summarized
  worldStateDelta: Record<string, any>; // Changes since last turn
  specificInstruction: string;      // Director's natural-language instruction
  allowedActions: string[];         // Scoped for current phase
  tokenBudget: number;              // Max output tokens
  mustEndWith?: string;             // e.g., "question", "choice", "description"
}
```

### 3.4 Content Agent → Director Result

```typescript
interface AgentResult {
  agentId: string;
  turnNumber: number;
  output: AgentAction[];  // Structured actions (speech, dice, scene change, etc.)
  stateChanges: Record<string, any>; // Side effects (HP changes, item pickups, etc.)
  memoryUpdate?: string;  // Per-agent memory to persist
  followUp?: string;      // Suggested next agent or instruction
  durationMs: number;
}
```

### 3.5 Error Handling

| Failure | Detection | Response |
|---------|-----------|----------|
| Agent timeout (>10s) | Worker timeout | Return fallback response, log error, retry once with simplified prompt |
| Invalid JSON output | Parse failure | Run jsonrepair, then re-ask with stricter schema |
| Hallucination (bad state) | Lore keeper check | Director re-dispatches with correction, logs incident |
| Director failure | No valid decision | Fall back to rule-based routing (phase → default agent) |
| Rate limit | 429 from LLM provider | Queue request, retry with exponential backoff |

---

## 4. Session State Machine

### 4.1 TTRPG Session States

```
SETUP ──→ INTRODUCTION ──→ EXPLORATION ──→ COMBAT ──→ ROLEPLAY ──→ CLIMAX ──→ RESOLUTION ──→ WRAP_UP
              │                 │    ↑↓        │    ↑↓           │
              │                 └────┘        └────┘            │
              │                 (alternate freely)                │
              └──────────────────────────────────────────────────┘
                              (can loop back to EXPLORATION)
```

#### State Definitions

| State | Description | Valid Agents | Player Mode | Auto-advance? |
|-------|-------------|-------------|-------------|---------------|
| `SETUP` | Character creation, world selection | `dungeon_master` | Setup forms | No (player-driven) |
| `INTRODUCTION` | Opening narration, hook | `dungeon_master`, `scene_builder` | Listening | After player acknowledges |
| `EXPLORATION` | Moving through the world, discovering | `dungeon_master`, `npc_*`, `scene_builder`, `lore_keeper` | Free input | No |
| `COMBAT` | Turn-based encounters | `dungeon_master`, `npc_*` (hostile), `combat_engine` | Turn-based actions | When enemies defeated / fled |
| `ROLEPLAY` | Dialogue, social interaction | `dungeon_master`, `npc_*` | Free dialogue | When scene concludes |
| `CLIMAX` | Major confrontation, boss fight, key decision | All agents | Critical choices | After resolution |
| `RESOLUTION` | Consequences, rewards, loose ends | `dungeon_master`, `npc_*` | Reaction | After DM wraps up |
| `WRAP_UP` | Session summary, XP, next session preview | `dungeon_master`, `progress_tracker` | Review | Manual end |

#### Valid Transitions

```typescript
const TTRPG_TRANSITIONS: Record<TTRPGPhase, TTRPGPhase[]> = {
  SETUP:         ['INTRODUCTION'],
  INTRODUCTION:  ['EXPLORATION', 'COMBAT', 'ROLEPLAY'],
  EXPLORATION:   ['EXPLORATION', 'COMBAT', 'ROLEPLAY', 'CLIMAX'],
  COMBAT:        ['COMBAT', 'EXPLORATION', 'ROLEPLAY', 'CLIMAX', 'RESOLUTION'],
  ROLEPLAY:      ['ROLEPLAY', 'EXPLORATION', 'COMBAT', 'CLIMAX'],
  CLIMAX:        ['COMBAT', 'ROLEPLAY', 'RESOLUTION'],
  RESOLUTION:    ['WRAP_UP', 'EXPLORATION'],
  WRAP_UP:       [], // terminal
};
```

### 4.2 Study Session States

```
SETUP ──→ OBJECTIVE ──→ LECTURE ──→ PRACTICE ──→ QUIZ ──→ REVIEW ──→ SUMMARY
              │              │          ↑↓        ↑↓          │
              │              └──────────┘        └──────────┘│
              └───────────────────────────────────────────────┘
                              (can loop LECTURE → PRACTICE → QUIZ)
```

#### State Definitions

| State | Description | Valid Agents | Player Mode | Auto-advance? |
|-------|-------------|-------------|-------------|---------------|
| `SETUP` | Topic selection, level assessment | `teacher` | Selection | No |
| `OBJECTIVE` | Learning goals, roadmap | `teacher` | Confirm | After acknowledgment |
| `LECTURE` | Content delivery, explanations | `teacher`, `classmate` | Listen + ask questions | When topic covered |
| `PRACTICE` | Guided exercises, worked examples | `teacher`, `tutor` | Active problem-solving | When exercises complete |
| `QUIZ` | Assessment, scored questions | `quiz_master` | Answer questions | After quiz completion |
| `REVIEW` | Review mistakes, reinforce weak areas | `tutor`, `teacher` | Q&A | When mastery improved |
| `SUMMARY` | Session recap, next steps, spaced repetition schedule | `teacher`, `progress_tracker` | Review | Manual end |

#### Valid Transitions

```typescript
const STUDY_TRANSITIONS: Record<StudyPhase, StudyPhase[]> = {
  SETUP:     ['OBJECTIVE'],
  OBJECTIVE: ['LECTURE'],
  LECTURE:   ['LECTURE', 'PRACTICE', 'QUIZ', 'REVIEW'],
  PRACTICE:  ['PRACTICE', 'QUIZ', 'LECTURE', 'REVIEW'],
  QUIZ:      ['QUIZ', 'REVIEW', 'LECTURE', 'SUMMARY'],
  REVIEW:    ['LECTURE', 'PRACTICE', 'QUIZ', 'SUMMARY'],
  SUMMARY:   [], // terminal
};
```

---

## 5. Implementation on Cloudflare Workers

### 5.1 Stateless Director Per Turn

The Director is not a persistent process. Each user turn triggers:

```typescript
// workers/api/session/[id]/turn.ts
export async function POST(request: Request, env: Env): Promise<Response> {
  const { sessionId, playerId, message } = await request.json();

  // 1. Load session state from D1 + KV
  const session = await loadSession(env, sessionId);

  // 2. Run Director decision (~500ms with fast model)
  const decision = await runDirector(session, message, env);

  // 3. If phase transition needed, update D1
  if (decision.phaseTransition) {
    await transitionPhase(env, session, decision.phaseTransition);
  }

  // 4. Dispatch to content agent (~1-3s with quality model)
  const result = await dispatchAgent(env, session, decision);

  // 5. Persist state changes, update KV context
  await persistTurn(env, session, decision, result);

  // 6. Stream response via SSE
  return streamAgentOutput(result.output);
}
```

### 5.2 Latency Budget

| Step | Target | Strategy |
|------|--------|----------|
| D1/KV read | < 50ms | Batch reads, KV for hot path |
| Director decision | < 500ms | Small prompt, fast model (Haiku/Gemini Flash) |
| Phase transition | < 50ms | Simple D1 write |
| Agent dispatch | < 2000ms | Streaming response, quality model (Sonnet/GPT-4o-mini) |
| State persist | < 100ms | Async write after response starts |
| **Total TTFB** | **< 800ms** | Director + agent dispatch start |

### 5.3 Token Budget Management

```
Director prompt:    ~300 tokens (system) + ~200 tokens (context summary) = 500 in
Director output:    ~150 tokens max
─────────────────────────────────────────────────────────────────────
Agent prompt:       ~500 tokens (system + persona) + ~800 tokens (context) = 1300 in
Agent output:       ~500 tokens max (narration), ~200 (NPC dialogue)
─────────────────────────────────────────────────────────────────────
Context window:     Rolling summary in KV (last 10 turns, ~1000 tokens)
                    Full history in D1 for deep retrieval (on demand)
```

### 5.4 Model Selection

| Role | Model | Why |
|------|-------|-----|
| Director | `claude-3-haiku` or `gemini-2.0-flash` | Fast, cheap, classification task |
| DM narration | `claude-3.5-sonnet` or `gpt-4o-mini` | Creative quality matters |
| NPC dialogue | `claude-3-haiku` or `gpt-4o-mini` | Short, personality-driven |
| Lore keeper | `claude-3-haiku` | Fact-checking, not creative |
| Teacher | `claude-3.5-sonnet` | Explanation quality critical |
| Classmate | `claude-3-haiku` | Simple persona, cheap |
| Quiz master | `claude-3-haiku` | Structured output, not creative |
| Tutor | `claude-3-haiku` or `gpt-4o-mini` | Socratic, pattern-based |

### 5.5 D1 Schema for Session State

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL CHECK (domain IN ('ttrpg', 'study')),
  phase TEXT NOT NULL,
  turn_number INTEGER DEFAULT 0,
  players TEXT NOT NULL DEFAULT '[]',  -- JSON array
  agents TEXT NOT NULL DEFAULT '[]',   -- JSON array of active agent configs
  world_state TEXT NOT NULL DEFAULT '{}', -- JSON blob
  config TEXT NOT NULL DEFAULT '{}',   -- Session configuration
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  turn_number INTEGER NOT NULL,
  player_id TEXT,
  message TEXT,
  director_decision TEXT,  -- JSON
  agent_result TEXT,        -- JSON
  state_delta TEXT,         -- JSON
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_turns_session ON turns(session_id, turn_number);
```

---

## 6. Multi-Player Support

### 6.1 Player Management

```typescript
interface Player {
  id: string;
  name: string;
  character?: TTRPGCharacter;
  connectionId: string;       // WebSocket or SSE connection
  lastActiveAt: number;
  isReady: boolean;
  preferences: {
    notificationLevel: 'all' | 'mentions' | 'none';
    pacingPreference: 'fast' | 'normal' | 'slow';
  };
}
```

### 6.2 Turn Management (TTRPG)

In combat/exploration, the Director manages a turn queue:

1. **Initiative order** (combat): `combat_engine` sorts by roll, Director dispatches in order
2. **Free-form** (exploration/roleplay): Director picks next speaker based on:
   - Who hasn't acted recently
   - Whose last action was addressed (NPC replies to their question)
   - Dramatic timing (let tension build before responding)
3. **Simultaneous input**: 500ms debounce window, Director batches and decides

### 6.3 Collaborative Study Sessions

```
Teacher presents topic
    │
    ├── Student A asks question → Tutor responds to Student A
    ├── Student B answers quiz question → Quiz Master scores B
    └── Classmate (AI) asks confused question → Teacher addresses whole class
```

Director ensures all students get attention:
- Track "last addressed" timestamp per student
- If any student is idle > 3 turns, inject a question directed at them
- Group activities: Director sets `mode: 'collaborative'`, agents address all players

### 6.4 Conflict Resolution

When two players want contradictory actions:

1. **Game-time conflict** (TTRPG): Director asks for a group decision or skill check
2. **Study conflict** (different topics): Director splits into parallel tracks or asks teacher to mediate
3. **System-level**: First-in-wins with queue, or priority based on session role (DM designate, group leader)

---

## 7. Cost Optimization

### 7.1 Tiered Model Strategy

| Decision Tier | Model | Cost/1M tokens | When Used |
|---------------|-------|----------------|-----------|
| Director | Haiku/Flash | ~$0.25 | Every turn |
| Simple agent (NPC small talk, classmate) | Haiku/Flash | ~$0.25 | Low-stakes interactions |
| Quality agent (DM narration, teacher) | Sonnet/GPT-4o-mini | ~$3.00 | Key narrative/educational moments |
| Creative burst (boss intro, complex explanation) | Opus/GPT-4o | ~$15.00 | Rare, high-impact only |

**Estimated cost per session:**
- TTRPG (2hr, ~60 turns): ~$0.50 (mostly Haiku Director + mixed agents)
- Study (1hr, ~30 turns): ~$0.30 (Haiku Director, Sonnet teacher)

### 7.2 Caching Strategy

| Cache Target | Store | TTL | Invalidate On |
|-------------|-------|-----|---------------|
| NPC personality + catchphrases | KV | Session lifetime | Agent config change |
| Rule descriptions (TTRPG) | KV | 24h | Manual purge |
| Lecture segments | KV | Session lifetime | Topic change |
| Director decisions (repeated patterns) | KV | 1h | Phase change |
| Agent system prompts | Workers cache (global) | Deploy | Deploy |

### 7.3 Pre-Generation

For predictable sequences, generate ahead in background:

```typescript
// After combat ends, pre-generate loot description
// After lecture topic set, pre-generate quiz questions
// After NPC introduced, pre-generate 3 likely responses

async function preGenerate(session: Session, triggers: PreGenTrigger[]): Promise<void> {
  // Uses Workers Queues + Durable Objects for background execution
  // Results stored in KV, consumed when Director dispatches matching agent
}
```

### 7.4 Context Window Optimization

- **Never send full history** to Director. Always summarize.
- Rolling summary: last 3 turns verbatim, older turns compressed to bullet points
- Summarize when context exceeds 80% of model window
- Store full history in D1, retrieve on demand only (e.g., "what did the NPC say about the map?")

---

## 8. Devil's Advocate

### 8.1 Is a Meta-Agent Director Worth It?

**For simple sessions (short chatbot interaction): No.** A rule-based router (like our existing `router.ts`) is faster, cheaper, and more predictable. The Director adds ~500ms latency and ~$0.01 per turn.

**For complex sessions (multi-agent TTRPG, multi-student classroom): Yes.** Without a Director, you need hardcoded rules for every phase transition and agent handoff. The LLM Director handles the combinatorial explosion of possible states gracefully. OpenMAIC proved this pattern works at scale for interactive classrooms.

**Recommendation:** Hybrid approach — use rule-based routing as the default, upgrade to LLM Director only for multi-agent sessions. This is essentially what OpenMAIC does (single-agent = code logic, multi-agent = LLM Director).

### 8.2 LLM Director vs. Rule-Based + ML Enhancement?

**LLM Director pros:**
- Handles novel situations (user does something unexpected)
- No manual rule maintenance
- Can reason about narrative flow, not just pattern matching

**LLM Director cons:**
- Added latency (~500ms per turn)
- Added cost (~$0.25/1M tokens per decision)
- Occasionally makes wrong decisions (hallucination)
- Harder to debug than rules

**Hybrid recommendation:**
1. **Phase transitions:** Rule-based (state machine validates transitions)
2. **Agent selection within phase:** LLM Director for multi-agent, rule-based for single-agent
3. **Interrupt detection:** Regex rules (fast path)
4. **Error recovery:** Rule-based fallbacks

```typescript
async function runDirector(session: Session, message: string): Promise<DirectorDecision> {
  // Fast path: rule-based
  if (session.agents.length === 1) {
    return { agentId: session.agents[0].id, ... }; // Pure code
  }
  
  // Check for interrupts (regex, fast)
  if (isInterrupt(message)) {
    return handleInterrupt(session, message);
  }
  
  // LLM decision for multi-agent
  return await llmDirectorDecision(session, message);
}
```

### 8.3 Preventing Director Confusion in Long Sessions

**Problem:** Context window fills up, Director loses track of what's happening.

**Mitigations:**
1. **Rolling summaries** — compress old turns aggressively (keep last 3 verbatim, rest as 1-line bullets)
2. **Phase reset** — when transitioning phases, reset Director context to phase-relevant info only
3. **World state anchoring** — Director receives current state snapshot, not history. "The party is in the dungeon. The guard is dead. The door is locked." Not "Turn 1: party entered. Turn 2: guard appeared..."
4. **Lore keeper as safety net** — separate agent validates consistency, can override Director
5. **Max session length** — hard limit (~200 turns), then force WRAP_UP or SUMMARY phase

### 8.4 What Happens When the Director Makes a Bad Decision?

| Type of Bad Decision | Example | Mitigation |
|---------------------|---------|------------|
| Wrong agent | Sends NPC to narrate scene | Agent's persona limits output quality; DM can self-correct next turn |
| Wrong phase transition | Jumps to COMBAT during dialogue | Player can `/ooc` override; state machine validates transitions |
| Agent loop | Two NPCs talk to each other forever | Turn limit per agent (max 2 consecutive); Director's "should_end" flag |
| Ignores player | Director keeps narrating | Player activity timeout → force "cue user" |
| Overly dramatic | Jumps to CLIMAX too early | Phase duration minimums (EXPLORATION ≥ 5 turns before CLIMAX) |

**Recovery pattern:** Every bad decision is one turn. Next turn, the Director can correct. The cost of one bad turn is ~$0.01 and ~3 seconds. This is acceptable for interactive sessions.

---

## 9. TypeScript Interfaces

### 9.1 Core Types

```typescript
// ─── Domain ────────────────────────────────────────────────────────────────

type Domain = 'ttrpg' | 'study';

// ─── Session Phases ───────────────────────────────────────────────────────

type TTRPGPhase =
  | 'SETUP'
  | 'INTRODUCTION'
  | 'EXPLORATION'
  | 'COMBAT'
  | 'ROLEPLAY'
  | 'CLIMAX'
  | 'RESOLUTION'
  | 'WRAP_UP';

type StudyPhase =
  | 'SETUP'
  | 'OBJECTIVE'
  | 'LECTURE'
  | 'PRACTICE'
  | 'QUIZ'
  | 'REVIEW'
  | 'SUMMARY';

type SessionPhase = TTRPGPhase | StudyPhase;

// ─── Agent Types ───────────────────────────────────────────────────────────

type AgentRole =
  // TTRPG
  | 'dungeon_master'
  | 'npc'
  | 'combat_engine'
  | 'lore_keeper'
  | 'scene_builder'
  | 'dice_roller'
  // Study
  | 'teacher'
  | 'classmate'
  | 'quiz_master'
  | 'tutor'
  | 'progress_tracker';

type ModelTier = 'fast' | 'quality' | 'premium';

interface AgentConfig {
  id: string;
  role: AgentRole;
  name: string;
  persona: string;
  avatar?: string;
  modelTier: ModelTier;
  allowedActions: string[];
  allowedPhases: SessionPhase[];
  priority: number; // Higher = speaks first
  maxConsecutiveTurns: number; // Prevent agent loops
  metadata: Record<string, any>; // Domain-specific (NPC stats, teacher subject, etc.)
}

// ─── Director Decision ────────────────────────────────────────────────────

interface PhaseTransition {
  from: SessionPhase;
  to: SessionPhase;
  reason: string;
  stateChanges?: Record<string, any>;
}

interface DirectorDecision {
  agentId: string;
  instructions: string;
  phaseTransition: PhaseTransition | null;
  shouldEnd: boolean;
  priority: 'high' | 'normal' | 'low';
  reasoning: string;
  tokenBudget?: number;
  mustEndWith?: 'question' | 'choice' | 'description' | 'action';
}

// ─── Agent Communication ──────────────────────────────────────────────────

interface AgentAction {
  type: 'speech' | 'narrate' | 'dice_roll' | 'scene_change'
    | 'stat_change' | 'inventory_update' | 'spotlight'
    | 'question' | 'quiz_question' | 'feedback'
    | 'hint' | 'whiteboard_draw' | 'ambience'
    | 'npc_appear' | 'npc_leave'
    | 'branch_choice' | 'time_pass';
  params: Record<string, any>;
}

interface AgentInstruction {
  sessionId: string;
  agentId: string;
  turnNumber: number;
  phase: SessionPhase;
  domain: Domain;
  playerMessage?: string;
  contextSummary: string;
  worldStateSnapshot: Record<string, any>;
  worldStateDelta: Record<string, any>;
  specificInstruction: string;
  allowedActions: string[];
  tokenBudget: number;
  mustEndWith?: string;
}

interface AgentResult {
  agentId: string;
  turnNumber: number;
  output: AgentAction[];
  stateChanges: Record<string, any>;
  memoryUpdate?: string;
  followUp?: string;
  durationMs: number;
  tokensUsed: { input: number; output: number };
}

// ─── Session State ────────────────────────────────────────────────────────

interface Player {
  id: string;
  name: string;
  connectionId: string;
  lastActiveAt: number;
  isReady: boolean;
  character?: {
    name: string;
    class?: string;
    level?: number;
    stats: Record<string, number>;
    inventory: string[];
  };
  preferences: {
    notificationLevel: 'all' | 'mentions' | 'none';
    pacingPreference: 'fast' | 'normal' | 'slow';
  };
}

interface SessionConfig {
  domain: Domain;
  maxTurns: number;
  maxTurnsPerAgent: number;
  directorModel: string;
  defaultAgentModel: string;
  enablePreGeneration: boolean;
  debounceWindowMs: number;
}

interface SessionState {
  id: string;
  domain: Domain;
  phase: SessionPhase;
  turnNumber: number;
  players: Player[];
  agents: AgentConfig[];
  worldState: Record<string, any>;
  config: SessionConfig;
  createdAt: number;
  updatedAt: number;
}

interface TurnRecord {
  id: string;
  sessionId: string;
  turnNumber: number;
  playerId?: string;
  playerMessage?: string;
  directorDecision: DirectorDecision;
  agentResult: AgentResult;
  stateDelta: Record<string, any>;
  createdAt: number;
}

// ─── Director Agent (Implementation) ──────────────────────────────────────

interface DirectorConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  systemPromptTemplate: string;
  contextWindow: number;
  summaryMaxTokens: number;
}

interface DirectorContext {
  session: SessionState;
  recentTurns: TurnRecord[];
  contextSummary: string;
  worldStateSnapshot: Record<string, any>;
}

interface DirectorAgent {
  config: DirectorConfig;
  decide(ctx: DirectorContext, playerMessage?: string): Promise<DirectorDecision>;
  decideRuleBased(ctx: DirectorContext, playerMessage?: string): DirectorDecision | null;
  isMultiAgent(session: SessionState): boolean;
  validateTransition(current: SessionPhase, target: SessionPhase): boolean;
}

// ─── Content Agent (Implementation) ───────────────────────────────────────

interface ContentAgent {
  config: AgentConfig;
  execute(instruction: AgentInstruction): Promise<AgentResult>;
  buildPrompt(instruction: AgentInstruction): Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  parseOutput(raw: string): AgentAction[];
  getSystemPrompt(agent: AgentConfig, domain: Domain): string;
}

// ─── State Machine ────────────────────────────────────────────────────────

interface StateMachineConfig<Phase extends string> {
  initial: Phase;
  transitions: Record<Phase, Phase[]>;
  phaseConfig: Record<Phase, {
    validAgents: AgentRole[];
    playerMode: 'setup' | 'listening' | 'free_input' | 'turn_based' | 'active' | 'review';
    autoAdvance: boolean;
    minTurns?: number;
    maxTurns?: number;
  }>;
}

class StateMachine<Phase extends string> {
  constructor(private config: StateMachineConfig<Phase>) {}

  canTransition(from: Phase, to: Phase): boolean {
    return this.config.transitions[from]?.includes(to) ?? false;
  }

  getValidAgents(phase: Phase): AgentRole[] {
    return this.config.phaseConfig[phase]?.validAgents ?? [];
  }

  getPlayerMode(phase: Phase): string {
    return this.config.phaseConfig[phase]?.playerMode ?? 'free_input';
  }

  shouldAutoAdvance(phase: Phase): boolean {
    return this.config.phaseConfig[phase]?.autoAdvance ?? false;
  }
}

// ─── Pre-Generation ───────────────────────────────────────────────────────

type PreGenTrigger =
  | { type: 'phase_enter'; phase: SessionPhase }
  | { type: 'npc_introduced'; npcId: string }
  | { type: 'topic_set'; topic: string }
  | { type: 'combat_end' };

interface PreGenTask {
  id: string;
  sessionId: string;
  trigger: PreGenTrigger;
  agentId: string;
  instruction: string;
  status: 'pending' | 'generating' | 'complete' | 'expired';
  result?: AgentResult;
  expiresAt: number;
}

// ─── Cost Tracking ────────────────────────────────────────────────────────

interface TurnCost {
  sessionId: string;
  turnNumber: number;
  directorCost: { inputTokens: number; outputTokens: number; model: string; costUsd: number };
  agentCosts: Array<{ agentId: string; inputTokens: number; outputTokens: number; model: string; costUsd: number }>;
  totalCostUsd: number;
}

interface SessionCostReport {
  sessionId: string;
  totalTurns: number;
  totalCostUsd: number;
  costByModel: Record<string, number>;
  costByAgent: Record<string, number>;
  averageTurnCostUsd: number;
}

// ─── TTRPG-Specific ───────────────────────────────────────────────────────

interface TTRPGCharacter {
  name: string;
  race: string;
  class: string;
  level: number;
  hp: { current: number; max: number };
  ac: number;
  stats: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  skills: Record<string, number>;
  inventory: Array<{ name: string; quantity: number; description?: string }>;
  conditions: string[];
}

interface NPCConfig extends AgentConfig {
  role: 'npc';
  metadata: {
    personality: string;
    knowledge: string[];
    secrets: string[];
    goals: string[];
    relationships: Record<string, 'ally' | 'enemy' | 'neutral' | 'unknown'>;
    location?: string;
    catchphrases?: string[];
  };
}

interface CombatState {
  isActive: boolean;
  round: number;
  turnOrder: Array<{ id: string; name: string; initiative: number; isPlayer: boolean }>;
  currentTurnIndex: number;
  enemies: Array<{ id: string; name: string; hp: number; maxHp: number; ac: number; conditions: string[] }>;
}

// ─── Study-Specific ───────────────────────────────────────────────────────

interface LearningObjective {
  id: string;
  topic: string;
  description: string;
  masteryTarget: number; // 0-1
  currentMastery: number;
  prerequisites: string[]; // objective IDs
}

interface QuizQuestion {
  id: string;
  type: 'multiple_choice' | 'short_answer' | 'true_false' | 'fill_blank';
  difficulty: 1 | 2 | 3 | 4 | 5;
  question: string;
  options?: string[];
  correctAnswer: string;
  explanation: string;
  topicTag: string;
  points: number;
}

interface StudentProgress {
  playerId: string;
  objectives: Record<string, number>; // objectiveId -> mastery 0-1
  quizScores: Array<{ quizId: string; score: number; total: number; date: number }>;
  questionsCorrect: number;
  questionsAttempted: number;
  streakDays: number;
  lastReviewAt: number;
  nextReviewAt: number; // spaced repetition
}

// ─── API Types ────────────────────────────────────────────────────────────

interface TurnRequest {
  sessionId: string;
  playerId: string;
  message: string;
  attachments?: Array<{ type: 'image' | 'file'; url: string }>;
}

interface TurnResponse {
  turnNumber: number;
  phase: SessionPhase;
  actions: AgentAction[];
  speakingAgent: string;
  stateChanges: Record<string, any>;
  cost: TurnCost;
}

interface SessionCreateRequest {
  domain: Domain;
  config?: Partial<SessionConfig>;
  players: Array<{ id: string; name: string }>;
  worldConfig?: Record<string, any>; // TTRPG: campaign settings; Study: topic/level
}

// ─── SSE Event Types ──────────────────────────────────────────────────────

type SSEEvent =
  | { type: 'director_decision'; data: DirectorDecision }
  | { type: 'agent_start'; data: { agentId: string; agentName: string } }
  | { type: 'action'; data: AgentAction }
  | { type: 'text_delta'; data: { content: string } }
  | { type: 'phase_change'; data: PhaseTransition }
  | { type: 'state_update'; data: Record<string, any> }
  | { type: 'error'; data: { message: string; code: string } }
  | { type: 'done'; data: TurnCost }
  | { type: 'cue_user'; data: { prompt?: string } };

// ─── Environment (Cloudflare Workers) ─────────────────────────────────────

interface Env {
  DB: D1Database;
  KV: KVNamespace;
  AI: Ai; // Workers AI binding (fallback)
  QUEUE: Queue<PreGenTask>;
  
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  
  DIRECTOR_MODEL: string;
  DEFAULT_AGENT_MODEL: string;
  MAX_SESSION_TURNS: string;
  
  SSE_STREAM_TIMEOUT: string;
}

// ─── Validation ───────────────────────────────────────────────────────────

const TTRPG_TRANSITIONS: Record<TTRPGPhase, TTRPGPhase[]> = {
  SETUP:         ['INTRODUCTION'],
  INTRODUCTION:  ['EXPLORATION', 'COMBAT', 'ROLEPLAY'],
  EXPLORATION:   ['EXPLORATION', 'COMBAT', 'ROLEPLAY', 'CLIMAX'],
  COMBAT:        ['COMBAT', 'EXPLORATION', 'ROLEPLAY', 'CLIMAX', 'RESOLUTION'],
  ROLEPLAY:      ['ROLEPLAY', 'EXPLORATION', 'COMBAT', 'CLIMAX'],
  CLIMAX:        ['COMBAT', 'ROLEPLAY', 'RESOLUTION'],
  RESOLUTION:    ['WRAP_UP', 'EXPLORATION'],
  WRAP_UP:       [],
};

const STUDY_TRANSITIONS: Record<StudyPhase, StudyPhase[]> = {
  SETUP:     ['OBJECTIVE'],
  OBJECTIVE: ['LECTURE'],
  LECTURE:   ['LECTURE', 'PRACTICE', 'QUIZ', 'REVIEW'],
  PRACTICE:  ['PRACTICE', 'QUIZ', 'LECTURE', 'REVIEW'],
  QUIZ:      ['QUIZ', 'REVIEW', 'LECTURE', 'SUMMARY'],
  REVIEW:    ['LECTURE', 'PRACTICE', 'QUIZ', 'SUMMARY'],
  SUMMARY:   [],
};

function validateTransition(domain: Domain, from: SessionPhase, to: SessionPhase): boolean {
  if (domain === 'ttrpg') {
    return (TTRPG_TRANSITIONS as Record<string, SessionPhase[]>)[from]?.includes(to) ?? false;
  }
  return (STUDY_TRANSITIONS as Record<string, SessionPhase[]>)[from]?.includes(to) ?? false;
}
```
