# Action System Design

> Core protocol connecting AI agents to the frontend for DMlog.ai (TTRPG) and StudyLog.ai (interactive learning).
>
> Based on analysis of OpenMAIC's structured action pattern, adapted for Cloudflare Workers + Preact.

---

## Table of Contents

1. [Action Protocol Specification](#1-action-protocol-specification)
2. [TypeScript Interfaces](#2-typescript-interfaces)
3. [SSE Streaming Protocol](#3-sse-streaming-protocol)
4. [Frontend Rendering Pipeline](#4-frontend-rendering-pipeline)
5. [Cloudflare Workers Compatibility](#5-cloudflare-workers-compatibility)
6. [Devil's Advocate](#6-devils-advocate)
7. [Migration Path](#7-migration-path)

---

## 1. Action Protocol Specification

### 1.1 Overview

Agents output **arrays of typed actions** — not freeform text. Each action is a JSON object with a `type` discriminator, a typed `payload`, and optional `meta`. The frontend consumes these as a stream via SSE, rendering each action with a domain-specific component.

This is directly modeled on OpenMAIC's proven pattern: agents output `[action, text, action, text, ...]` interleaved arrays, parsed with streaming JSON repair.

### 1.2 Base Structure

Every action follows this envelope:

```json
{
  "type": "narration",
  "payload": { "...": "..." },
  "meta": {
    "id": "act_abc123",
    "agent_id": "dm-goblin-king",
    "priority": 5,
    "blocking": true,
    "delay_ms": 0,
    "timestamp": 1743000000000
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `ActionType` | ✅ | Discriminator enum |
| `payload` | `T` (type-specific) | ✅ | Action-specific data |
| `meta` | `ActionMeta` | ❌ | Timing, priority, agent identity |

### 1.3 Metadata

```typescript
interface ActionMeta {
  /** Unique action ID (auto-generated if omitted) */
  id?: string;
  /** Which agent produced this action */
  agent_id?: string;
  /** Priority 0-10. Higher = rendered first. Default: 5 */
  priority?: number;
  /** Whether the pipeline should wait before processing the next action. Default: false */
  blocking?: boolean;
  /** Delay before rendering (ms). Default: 0 */
  delay_ms?: number;
  /** Server-generated timestamp */
  timestamp?: number;
  /** Expiry — don't render if received after this (ms since epoch) */
  expires_at?: number;
  /** Grouping key — actions with same group render together */
  group?: string;
}
```

### 1.4 Complete Action Type Catalog

#### 1.4.1 Shared Actions (TTRPG + Study)

##### `narration` — Long-form text with markdown

The primary output for descriptive content. Supports full markdown (headers, lists, bold, italic, links, images).

```json
{
  "type": "narration",
  "payload": {
    "text": "## The Forgotten Tomb\n\nYou descend the worn stone steps...",
    "style": "prose",
    "duration_hint_ms": 8000
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `text` | `string` | Markdown content |
| `style` | `'prose' \| 'dramatic' \| 'technical' \| 'casual'` | Affects rendering style |
| `duration_hint_ms` | `number` | Suggested display duration (for auto-advance) |

##### `speech` — Character/persona dialogue

Dialogue attributed to a specific character or persona. Includes voice and emotion for TTS.

```json
{
  "type": "speech",
  "payload": {
    "character": "Grimjaw the Guard",
    "character_id": "npc-grimjaw",
    "text": "Halt! None pass without the warden's seal.",
    "voice_id": "onnx-Gruff-Male-1",
    "emotion": "suspicious",
    "avatar_url": "/avatars/grimjaw.png",
    "direction": "The guard raises his halberd, blocking the path."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `character` | `string` | Display name |
| `character_id` | `string` | Stable ID for styling/state |
| `text` | `string` | Dialogue text (may contain markdown emphasis) |
| `voice_id` | `string` | TTS voice identifier |
| `emotion` | `string` | Emotion tag for avatar/voice modulation |
| `avatar_url` | `string` | Avatar image URL |
| `direction` | `string` | Stage direction / action description |

##### `question` — Ask the user something

An open-ended question that requires a user response before the session continues.

```json
{
  "type": "question",
  "payload": {
    "prompt": "The merchant offers you a map for 50 gold. What do you do?",
    "context": "You are in the market district. The merchant seems nervous.",
    "valid_answers": ["accept", "decline", "haggle", "inspect map", "attack"],
    "timeout_ms": null,
    "impact": "narrative_branch"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `prompt` | `string` | The question text |
| `context` | `string` | Context for the user (what's happening) |
| `valid_answers` | `string[]` | Suggested answers (buttons). Empty = freeform |
| `timeout_ms` | `number \| null` | Auto-advance after timeout. null = wait forever |
| `impact` | `'narrative_branch' \| 'skill_check' \| 'roleplay' \| 'knowledge_check'` | What this question affects |

##### `quiz` — Multiple choice or open-ended question with scoring

Graded question with points, correct answer, and analysis.

```json
{
  "type": "quiz",
  "payload": {
    "id": "q-dc-check-1",
    "question": "What is the result of 2d6 + 3?",
    "type": "multiple",
    "options": [
      { "label": "A", "text": "5" },
      { "label": "B", "text": "9" },
      { "label": "C", "text": "15" },
      { "label": "D", "text": "3" }
    ],
    "correct_answer": ["B"],
    "points": 10,
    "analysis": "2d6 ranges from 2-12, plus 3 = 5-15. 9 is the average result.",
    "time_limit_ms": 30000
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique question ID |
| `question` | `string` | Question text |
| `type` | `'single' \| 'multiple' \| 'short_answer'` | Question format |
| `options` | `QuizOption[]` | For multiple choice |
| `correct_answer` | `string[]` | Correct option labels (or answer text) |
| `points` | `number` | Points awarded |
| `analysis` | `string` | Explanation shown after answer |
| `time_limit_ms` | `number` | Optional time limit |

##### `highlight` — Draw attention to specific content

Visual attention-directing action. Maps to OpenMAIC's `spotlight` action.

```json
{
  "type": "highlight",
  "payload": {
    "target": "npc-grimjaw",
    "target_type": "character",
    "style": "glow",
    "duration_ms": 3000,
    "pulse": true,
    "label": "Suspicious Guard"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `target` | `string` | Element ID to highlight |
| `target_type` | `'character' \| 'element' \| 'region' \| 'text'` | What kind of thing |
| `style` | `'glow' \| 'border' \| 'pulse' \| 'underline' \| 'spotlight'` | Visual style |
| `duration_ms` | `number` | How long to highlight |
| `pulse` | `boolean` | Animate with pulsing effect |
| `label` | `string` | Optional label to show |

##### `timer` — Start/end a countdown

```json
{
  "type": "timer",
  "payload": {
    "action": "start",
    "duration_ms": 60000,
    "label": "Combat Round",
    "on_expire": "auto_resolve",
    "warning_at_ms": 10000,
    "visible": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `action` | `'start' \| 'pause' \| 'resume' \| 'cancel' \| 'expire'` | Timer command |
| `duration_ms` | `number` | Duration (for start) |
| `label` | `string` | Display label |
| `on_expire` | `'auto_resolve' \| 'alert' \| 'extend' \| 'custom'` | Expiry behavior |
| `warning_at_ms` | `number` | Show warning N ms before expiry |
| `visible` | `boolean` | Show to user |

##### `progress` — Update a progress bar or milestone

```json
{
  "type": "progress",
  "payload": {
    "id": "lesson-progress",
    "value": 0.65,
    "label": "Lesson 3 of 5",
    "total": 5,
    "current": 3,
    "milestone": "Midpoint reached — you've learned the basics!"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Progress bar ID |
| `value` | `number` | 0.0 – 1.0 |
| `label` | `string` | Display label |
| `total` | `number` | Total items |
| `current` | `number` | Current item |
| `milestone` | `string` | Optional milestone message |

---

#### 1.4.2 TTRPG-Specific Actions

##### `scene_transition` — Change scene/location

```json
{
  "type": "scene_transition",
  "payload": {
    "scene_id": "tavern-interior",
    "name": "The Rusty Anchor Tavern",
    "description": "The smell of stale ale and woodsmoke fills the air...",
    "atmosphere": "warm, crowded, dim lighting",
    "map_url": "/maps/rusty-anchor.svg",
    "transition": "fade",
    "duration_ms": 2000,
    "npcs_present": ["npc-bartender", "npc-bard", "npc-mysterious-stranger"],
    "ambient_cue": "tavern-bg"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `scene_id` | `string` | Stable scene identifier |
| `name` | `string` | Scene display name |
| `description` | `string` | Narrative description |
| `atmosphere` | `string` | Mood/weather/lighting tags |
| `map_url` | `string` | Optional map image or SVG |
| `transition` | `'fade' \| 'dissolve' \| 'cut' \| 'wipe'` | Transition animation |
| `duration_ms` | `number` | Transition animation duration |
| `npcs_present` | `string[]` | NPC IDs in this scene |
| `ambient_cue` | `string` | Ambient sound to play |

##### `dice_roll` — Dice notation with animation

```json
{
  "type": "dice_roll",
  "payload": {
    "notation": "2d6+3",
    "rolls": [4, 2],
    "modifier": 3,
    "total": 9,
    "reason": "Persuasion check",
    "difficulty_class": 15,
    "success": false,
    "character_id": "pc-thalion",
    "rolled_by": "player",
    "critical": null,
    "animation": "3d_bounce",
    "color": "#4a9eff"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `notation` | `string` | Dice notation string |
| `rolls` | `number[]` | Individual die results |
| `modifier` | `number` | Static modifier |
| `total` | `number` | Final result |
| `reason` | `string` | What the roll is for |
| `difficulty_class` | `number` | DC to beat (optional) |
| `success` | `boolean \| null` | Pass/fail (null if no DC) |
| `character_id` | `string` | Who rolled |
| `rolled_by` | `'player' \| 'dm' \| 'npc'` | Who triggered the roll |
| `critical` | `'success' \| 'failure' \| null` | Nat 20 / Nat 1 |
| `animation` | `'3d_bounce' \| 'flat' \| 'none'` | Dice animation style |
| `color` | `string` | Accent color for the result |

##### `initiative` — Set/update turn order

```json
{
  "type": "initiative",
  "payload": {
    "action": "set",
    "order": [
      { "id": "npc-goblin-1", "name": "Goblin Scout", "initiative": 18, "hp": 7, "max_hp": 7 },
      { "id": "pc-thalion", "name": "Thalion", "initiative": 15, "hp": 28, "max_hp": 32 },
      { "id": "npc-goblin-2", "name": "Goblin Archer", "initiative": 12, "hp": 7, "max_hp": 7 }
    ],
    "round": 1,
    "current_turn": 0,
    "surprise": ["npc-goblin-1"]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `action` | `'set' \| 'add' \| 'remove' \| 'next' \| 'end_combat'` | Initiative action |
| `order` | `InitiativeEntry[]` | Turn order list |
| `round` | `number` | Current round number |
| `current_turn` | `number` | Index of current turn in order |
| `surprise` | `string[]` | IDs with surprise advantage |

##### `combat_round` — Full combat round with attacks, damage, saves

```json
{
  "type": "combat_round",
  "payload": {
    "round": 2,
    "turns": [
      {
        "actor_id": "npc-goblin-1",
        "action_type": "attack",
        "target_id": "pc-thalion",
        "attack_roll": 14,
        "hit": true,
        "damage": [{ "dice": "1d6+2", "amount": 5, "type": "piercing" }],
        "description": "The goblin lunges with its scimitar!"
      },
      {
        "actor_id": "pc-thalion",
        "action_type": "save",
        "save_type": "dexterity",
        "dc": 13,
        "roll": 16,
        "success": true,
        "description": "Thalion dodges the falling debris!"
      }
    ],
    "summary": "Round 2 complete. 1 goblin down, Thalion took 5 piercing damage."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `round` | `number` | Round number |
| `turns` | `CombatTurn[]` | Ordered list of combat actions |
| `summary` | `string` | Brief summary for the combat log |

##### `map_reveal` — Show/annotate a map or battle grid

```json
{
  "type": "map_reveal",
  "payload": {
    "map_id": "dungeon-level-1",
    "action": "reveal_region",
    "regions": [{ "id": "room-3", "label": "Guard Room", "bounds": { "x": 200, "y": 150, "w": 100, "h": 80 } }],
    "markers": [
      { "id": "trap-1", "type": "trap", "x": 250, "y": 190, "icon": "⚠️", "visible": true },
      { "id": "door-1", "type": "door", "x": 300, "y": 150, "icon": "🚪", "state": "locked" }
    ],
    "player_positions": [
      { "character_id": "pc-thalion", "x": 210, "y": 170, "icon": "🧙" }
    ],
    "fog_of_war": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `map_id` | `string` | Map identifier |
| `action` | `'show' \| 'reveal_region' \| 'hide_region' \| 'annotate' \| 'clear'` | Map action |
| `regions` | `MapRegion[]` | Regions to show/hide |
| `markers` | `MapMarker[]` | Points of interest |
| `player_positions` | `MapPosition[]` | Character/token positions |
| `fog_of_war` | `boolean` | Enable fog of war overlay |

##### `npc_action` — An NPC does something visible

```json
{
  "type": "npc_action",
  "payload": {
    "npc_id": "npc-mysterious-stranger",
    "action": "stand_up",
    "description": "The cloaked figure rises slowly, their face still hidden in shadow.",
    "visible_to": ["pc-thalion", "pc-aria"],
    "consequence": "npc-mysterious-stranger_approaches"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `npc_id` | `string` | NPC identifier |
| `action` | `string` | What the NPC does |
| `description` | `string` | Narrative description |
| `visible_to` | `string[]` | Which PCs can see this |
| `consequence` | `string` | Follow-up action ID to queue |

##### `inventory_change` — Add/remove item from character sheet

```json
{
  "type": "inventory_change",
  "payload": {
    "character_id": "pc-thalion",
    "action": "add",
    "item": {
      "id": "item-flamebrand",
      "name": "Flamebrand",
      "type": "weapon",
      "rarity": "rare",
      "description": "A longsword that glows with faint fire.",
      "quantity": 1,
      "weight": 3
    },
    "reason": "Found in the dragon's hoard"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `character_id` | `string` | Target character |
| `action` | `'add' \| 'remove' \| 'equip' \| 'unequip' \| 'update'` | Inventory action |
| `item` | `InventoryItem` | Item data |
| `reason` | `string` | Why this happened |

##### `ambient` — Sound/atmosphere cue

```json
{
  "type": "ambient",
  "payload": {
    "cue_id": "tavern-bg",
    "action": "play",
    "description": "Bustling tavern ambiance with faint lute music",
    "volume": 0.3,
    "fade_ms": 2000,
    "loop": true,
    "category": "atmosphere"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `cue_id` | `string` | Sound cue identifier |
| `action` | `'play' \| 'stop' \| 'crossfade' \| 'set_volume'` | Playback action |
| `description` | `string` | Human-readable description |
| `volume` | `number` | 0.0 – 1.0 |
| `fade_ms` | `number` | Fade in/out duration |
| `loop` | `boolean` | Loop the sound |
| `category` | `'atmosphere' \| 'music' \| 'sfx' \| 'weather' \| 'crowd'` | Sound category |

##### `character_update` — HP, condition, or stat change

```json
{
  "type": "character_update",
  "payload": {
    "character_id": "pc-thalion",
    "changes": [
      { "stat": "hp", "value": -5, "reason": "Goblin scimitar hit", "new_value": 27 },
      { "stat": "condition", "value": "bleeding", "duration": "until treated" }
    ],
    "temporary": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `character_id` | `string` | Target character |
| `changes` | `StatChange[]` | Array of stat modifications |
| `temporary` | `boolean` | True if reverted later |

##### `flashback` — Jump to a past event with context

```json
{
  "type": "flashback",
  "payload": {
    "title": "The Fall of Silverkeep",
    "description": "You remember the night the castle burned...",
    "narration": "Flames licked at the ancient stones. Your mentor's voice echoed...",
    "duration_ms": 15000,
    "atmosphere": "dark, fire-lit, somber",
    "return_context": "You snap back to the present, the merchant still waiting for your answer."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | Flashback title |
| `description` | `string` | Brief setup |
| `narration` | `string` | Full flashback narration |
| `duration_ms` | `number` | Suggested display time |
| `atmosphere` | `string` | Visual atmosphere change |
| `return_context` | `string` | Transition back to present |

---

#### 1.4.3 Study-Specific Actions

##### `slide` — Present a slide with title, content, layout type

```json
{
  "type": "slide",
  "payload": {
    "slide_number": 3,
    "total_slides": 12,
    "title": "React Component Lifecycle",
    "layout": "title_content",
    "content": "Components mount → render → update → unmount...",
    "elements": [
      { "id": "diagram-1", "type": "image", "src": "/slides/lifecycle.png", "x": 100, "y": 200 }
    ],
    "notes": "Teacher notes: explain mount vs update phases",
    "transition": "slide_left"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `slide_number` | `number` | Current slide |
| `total_slides` | `number` | Total slides in deck |
| `title` | `string` | Slide title |
| `layout` | `'title_only' \| 'title_content' \| 'two_column' \| 'blank' \| 'image_full'` | Layout template |
| `content` | `string` | Main content (markdown) |
| `elements` | `SlideElement[]` | Positioned elements |
| `notes` | `string` | Speaker notes |
| `transition` | `'slide_left' \| 'fade' \| 'none'` | Transition animation |

##### `whiteboard` — Draw diagram/formula/equation on canvas

Maps to OpenMAIC's wb_* action family.

```json
{
  "type": "whiteboard",
  "payload": {
    "action": "draw",
    "items": [
      { "type": "text", "text": "E = mc²", "x": 400, "y": 200, "font_size": 32, "color": "#fff" },
      { "type": "shape", "shape": "arrow", "x": 500, "y": 250, "width": 100, "height": 2, "color": "#4a9eff" },
      { "type": "latex", "latex": "\\int_0^\\infty e^{-x} dx = 1", "x": 300, "y": 350 }
    ],
    "clear": false
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `action` | `'draw' \| 'clear' \| 'undo' \| 'animate'` | Whiteboard action |
| `items` | `WhiteboardItem[]` | Items to draw |
| `clear` | `boolean` | Clear canvas first |

##### `code_block` — Show executable code with syntax highlighting

```json
{
  "type": "code_block",
  "payload": {
    "language": "typescript",
    "code": "const sum = (a: number, b: number): number => a + b;",
    "filename": "utils.ts",
    "line_highlight": [1],
    "executable": true,
    "output": null,
    "annotations": [
      { "line": 1, "type": "info", "text": "Arrow function with type annotations" }
    ]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `language` | `string` | Programming language |
| `code` | `string` | Code content |
| `filename` | `string` | Display filename |
| `line_highlight` | `number[]` | Lines to highlight |
| `executable` | `boolean` | Can the user run this? |
| `output` | `string \| null` | Pre-filled output |
| `annotations` | `CodeAnnotation[]` | Per-line annotations |

##### `interactive` — Embed an interactive HTML widget/simulation

```json
{
  "type": "interactive",
  "payload": {
    "id": "binary-search-viz",
    "title": "Binary Search Visualizer",
    "widget_type": "html",
    "source": "<canvas id='bs-canvas'></canvas><script>...</script>",
    "sandbox": true,
    "height_px": 400,
    "instructions": "Click on array elements to search for values."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Widget ID |
| `title` | `string` | Widget title |
| `widget_type` | `'html' \| 'svg' \| 'canvas' \| 'mermaid'` | Widget type |
| `source` | `string` | HTML/SVG source |
| `sandbox` | `boolean` | Run in sandboxed iframe |
| `height_px` | `number` | Widget height |
| `instructions` | `string` | Usage instructions |

##### `flashcard` — Show a flashcard with front/back

```json
{
  "type": "flashcard",
  "payload": {
    "deck": "javascript-basics",
    "card_id": "closures",
    "front": "What is a closure in JavaScript?",
    "back": "A function that retains access to its lexical scope even when executed outside that scope.",
    "difficulty": 3,
    "tags": ["functions", "scope"]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `deck` | `string` | Deck name |
| `card_id` | `string` | Card ID |
| `front` | `string` | Question/prompt side |
| `back` | `string` | Answer/explanation side |
| `difficulty` | `number` | 1-5 difficulty rating |
| `tags` | `string[]` | Topic tags |

##### `spaced_review` — Schedule a review based on spaced repetition

```json
{
  "type": "spaced_review",
  "payload": {
    "card_id": "closures",
    "rating": 3,
    "algorithm": "sm2",
    "next_review": "2026-03-28T08:00:00Z",
    "interval_days": 2,
    "ease_factor": 2.5,
    "stats": { "reviews": 5, "correct": 4, "streak": 3 }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `card_id` | `string` | Card being reviewed |
| `rating` | `number` | User's self-assessment 1-5 |
| `algorithm` | `'sm2' \| 'leitner'` | Spaced repetition algorithm |
| `next_review` | `string` | ISO date of next review |
| `interval_days` | `number` | Days until next review |
| `ease_factor` | `number` | SM2 ease factor |
| `stats` | `ReviewStats` | Cumulative stats |

##### `exercise` — Present a practice problem with steps

```json
{
  "type": "exercise",
  "payload": {
    "id": "ex-1",
    "title": "Implement a Stack",
    "difficulty": "medium",
    "instructions": "Implement a stack with push, pop, and peek methods.",
    "starter_code": "class Stack {\n  // your code here\n}",
    "language": "javascript",
    "test_cases": [
      { "input": "push(1); push(2); pop()", "expected": "2" },
      { "input": "peek()", "expected": "1" }
    ],
    "hints": ["Think about what data structure holds the items", "Array has push and pop built in"],
    "solution": "class Stack {\n  #items = [];\n  push(val) { this.#items.push(val); }\n  pop() { return this.#items.pop(); }\n  peek() { return this.#items[this.#items.length - 1]; }\n}"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Exercise ID |
| `title` | `string` | Exercise title |
| `difficulty` | `'easy' \| 'medium' \| 'hard'` | Difficulty level |
| `instructions` | `string` | What to do |
| `starter_code` | `string` | Code template |
| `language` | `string` | Programming language |
| `test_cases` | `TestCase[]` | Test cases |
| `hints` | `string[]` | Progressive hints |
| `solution` | `string` | Solution code |

##### `reference` — Show a reference card/cheat sheet

```json
{
  "type": "reference",
  "payload": {
    "title": "CSS Flexbox Cheat Sheet",
    "content": "## Main Axis\n- `justify-content`: flex-start | center | flex-end | space-between | space-around\n- `align-items`: stretch | flex-start | center | flex-end | baseline",
    "category": "css",
    "tags": ["layout", "flexbox"],
    "pinnable": true
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | Reference title |
| `content` | `string` | Markdown content |
| `category` | `string` | Topic category |
| `tags` | `string[]` | Tags |
| `pinnable` | `boolean` | Can user pin to sidebar |

---

## 2. TypeScript Interfaces

```typescript
// ─── Action System Types ──────────────────────────────────────────────────

/** All action type discriminators */
export type ActionType =
  // Shared
  | 'narration'
  | 'speech'
  | 'question'
  | 'quiz'
  | 'highlight'
  | 'timer'
  | 'progress'
  // TTRPG
  | 'scene_transition'
  | 'dice_roll'
  | 'initiative'
  | 'combat_round'
  | 'map_reveal'
  | 'npc_action'
  | 'inventory_change'
  | 'ambient'
  | 'character_update'
  | 'flashback'
  // Study
  | 'slide'
  | 'whiteboard'
  | 'code_block'
  | 'interactive'
  | 'flashcard'
  | 'spaced_review'
  | 'exercise'
  | 'reference';

// ─── Metadata ─────────────────────────────────────────────────────────────

export interface ActionMeta {
  id?: string;
  agent_id?: string;
  priority?: number;       // 0-10, default 5
  blocking?: boolean;      // default false
  delay_ms?: number;       // default 0
  timestamp?: number;
  expires_at?: number;
  group?: string;
}

// ─── Base Action ──────────────────────────────────────────────────────────

export interface BaseAction<T extends ActionType> {
  type: T;
  meta?: ActionMeta;
}

// ─── Shared Payloads ──────────────────────────────────────────────────────

export interface NarrationPayload {
  text: string;
  style?: 'prose' | 'dramatic' | 'technical' | 'casual';
  duration_hint_ms?: number;
}

export interface SpeechPayload {
  character: string;
  character_id: string;
  text: string;
  voice_id?: string;
  emotion?: string;
  avatar_url?: string;
  direction?: string;
}

export interface QuestionPayload {
  prompt: string;
  context?: string;
  valid_answers?: string[];
  timeout_ms?: number | null;
  impact?: 'narrative_branch' | 'skill_check' | 'roleplay' | 'knowledge_check';
}

export interface QuizOption {
  label: string;
  text: string;
}

export interface QuizPayload {
  id: string;
  question: string;
  type: 'single' | 'multiple' | 'short_answer';
  options?: QuizOption[];
  correct_answer?: string[];
  points?: number;
  analysis?: string;
  time_limit_ms?: number;
}

export interface HighlightPayload {
  target: string;
  target_type: 'character' | 'element' | 'region' | 'text';
  style?: 'glow' | 'border' | 'pulse' | 'underline' | 'spotlight';
  duration_ms?: number;
  pulse?: boolean;
  label?: string;
}

export interface TimerPayload {
  action: 'start' | 'pause' | 'resume' | 'cancel' | 'expire';
  duration_ms?: number;
  label?: string;
  on_expire?: 'auto_resolve' | 'alert' | 'extend' | 'custom';
  warning_at_ms?: number;
  visible?: boolean;
}

export interface ProgressPayload {
  id: string;
  value: number;
  label?: string;
  total?: number;
  current?: number;
  milestone?: string;
}

// ─── TTRPG Payloads ───────────────────────────────────────────────────────

export interface SceneTransitionPayload {
  scene_id: string;
  name: string;
  description: string;
  atmosphere?: string;
  map_url?: string;
  transition?: 'fade' | 'dissolve' | 'cut' | 'wipe';
  duration_ms?: number;
  npcs_present?: string[];
  ambient_cue?: string;
}

export interface DiceRollPayload {
  notation: string;
  rolls: number[];
  modifier: number;
  total: number;
  reason?: string;
  difficulty_class?: number;
  success?: boolean | null;
  character_id?: string;
  rolled_by?: 'player' | 'dm' | 'npc';
  critical?: 'success' | 'failure' | null;
  animation?: '3d_bounce' | 'flat' | 'none';
  color?: string;
}

export interface InitiativeEntry {
  id: string;
  name: string;
  initiative: number;
  hp: number;
  max_hp: number;
}

export interface InitiativePayload {
  action: 'set' | 'add' | 'remove' | 'next' | 'end_combat';
  order?: InitiativeEntry[];
  round?: number;
  current_turn?: number;
  surprise?: string[];
}

export interface CombatTurn {
  actor_id: string;
  action_type: 'attack' | 'save' | 'spell' | 'move' | 'bonus' | 'free';
  target_id?: string;
  attack_roll?: number;
  hit?: boolean;
  damage?: Array<{ dice: string; amount: number; type: string }>;
  save_type?: string;
  dc?: number;
  roll?: number;
  success?: boolean;
  description?: string;
}

export interface CombatRoundPayload {
  round: number;
  turns: CombatTurn[];
  summary?: string;
}

export interface MapRegion {
  id: string;
  label: string;
  bounds: { x: number; y: number; w: number; h: number };
}

export interface MapMarker {
  id: string;
  type: string;
  x: number;
  y: number;
  icon?: string;
  visible?: boolean;
  state?: string;
}

export interface MapPosition {
  character_id: string;
  x: number;
  y: number;
  icon?: string;
}

export interface MapRevealPayload {
  map_id: string;
  action: 'show' | 'reveal_region' | 'hide_region' | 'annotate' | 'clear';
  regions?: MapRegion[];
  markers?: MapMarker[];
  player_positions?: MapPosition[];
  fog_of_war?: boolean;
}

export interface NpcActionPayload {
  npc_id: string;
  action: string;
  description?: string;
  visible_to?: string[];
  consequence?: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  type: string;
  rarity?: string;
  description?: string;
  quantity: number;
  weight?: number;
}

export interface InventoryChangePayload {
  character_id: string;
  action: 'add' | 'remove' | 'equip' | 'unequip' | 'update';
  item: Partial<InventoryItem>;
  reason?: string;
}

export interface AmbientPayload {
  cue_id: string;
  action: 'play' | 'stop' | 'crossfade' | 'set_volume';
  description?: string;
  volume?: number;
  fade_ms?: number;
  loop?: boolean;
  category?: 'atmosphere' | 'music' | 'sfx' | 'weather' | 'crowd';
  crossfade_to?: string;
}

export interface StatChange {
  stat: string;
  value: string | number | boolean;
  reason?: string;
  new_value?: string | number | boolean;
  duration?: string;
}

export interface CharacterUpdatePayload {
  character_id: string;
  changes: StatChange[];
  temporary?: boolean;
}

export interface FlashbackPayload {
  title: string;
  description?: string;
  narration?: string;
  duration_ms?: number;
  atmosphere?: string;
  return_context?: string;
}

// ─── Study Payloads ───────────────────────────────────────────────────────

export interface SlideElement {
  id: string;
  type: 'image' | 'text' | 'shape';
  src?: string;
  text?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface SlidePayload {
  slide_number: number;
  total_slides: number;
  title: string;
  layout?: 'title_only' | 'title_content' | 'two_column' | 'blank' | 'image_full';
  content?: string;
  elements?: SlideElement[];
  notes?: string;
  transition?: 'slide_left' | 'fade' | 'none';
}

export interface WhiteboardItem {
  type: 'text' | 'shape' | 'latex' | 'line' | 'arrow' | 'freehand';
  text?: string;
  latex?: string;
  shape?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  font_size?: number;
  color?: string;
  points?: Array<{ x: number; y: number }>;
}

export interface WhiteboardPayload {
  action: 'draw' | 'clear' | 'undo' | 'animate';
  items?: WhiteboardItem[];
  clear?: boolean;
}

export interface CodeAnnotation {
  line: number;
  type: 'info' | 'warning' | 'error' | 'success';
  text: string;
}

export interface CodeBlockPayload {
  language: string;
  code: string;
  filename?: string;
  line_highlight?: number[];
  executable?: boolean;
  output?: string | null;
  annotations?: CodeAnnotation[];
}

export interface InteractivePayload {
  id: string;
  title: string;
  widget_type: 'html' | 'svg' | 'canvas' | 'mermaid';
  source: string;
  sandbox?: boolean;
  height_px?: number;
  instructions?: string;
}

export interface FlashcardPayload {
  deck: string;
  card_id: string;
  front: string;
  back: string;
  difficulty?: number;
  tags?: string[];
}

export interface ReviewStats {
  reviews: number;
  correct: number;
  streak: number;
}

export interface SpacedReviewPayload {
  card_id: string;
  rating: number;
  algorithm: 'sm2' | 'leitner';
  next_review: string;
  interval_days: number;
  ease_factor?: number;
  stats?: ReviewStats;
}

export interface TestCase {
  input: string;
  expected: string;
}

export interface ExercisePayload {
  id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  instructions: string;
  starter_code?: string;
  language?: string;
  test_cases?: TestCase[];
  hints?: string[];
  solution?: string;
}

export interface ReferencePayload {
  title: string;
  content: string;
  category?: string;
  tags?: string[];
  pinnable?: boolean;
}

// ─── Payload Map (type → payload interface) ────────────────────────────────

export interface ActionPayloadMap {
  narration: NarrationPayload;
  speech: SpeechPayload;
  question: QuestionPayload;
  quiz: QuizPayload;
  highlight: HighlightPayload;
  timer: TimerPayload;
  progress: ProgressPayload;
  scene_transition: SceneTransitionPayload;
  dice_roll: DiceRollPayload;
  initiative: InitiativePayload;
  combat_round: CombatRoundPayload;
  map_reveal: MapRevealPayload;
  npc_action: NpcActionPayload;
  inventory_change: InventoryChangePayload;
  ambient: AmbientPayload;
  character_update: CharacterUpdatePayload;
  flashback: FlashbackPayload;
  slide: SlidePayload;
  whiteboard: WhiteboardPayload;
  code_block: CodeBlockPayload;
  interactive: InteractivePayload;
  flashcard: FlashcardPayload;
  spaced_review: SpacedReviewPayload;
  exercise: ExercisePayload;
  reference: ReferencePayload;
}

// ─── Typed Action Union ───────────────────────────────────────────────────

export type Action = {
  [K in ActionType]: BaseAction<K> & { payload: ActionPayloadMap[K] };
}[ActionType];

// ─── Agent Output ─────────────────────────────────────────────────────────

/** What the AI backend returns — an ordered array of actions */
export type ActionStream = Action[];

/** Full agent response including metadata */
export interface AgentOutput {
  /** Ordered actions to render */
  actions: ActionStream;
  /** Session-level metadata */
  session?: {
    session_id: string;
    domain: 'ttrpg' | 'study';
    turn_number: number;
  };
  /** Model usage info */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  /** Debug info (stripped in production) */
  _debug?: {
    model: string;
    latency_ms: number;
    raw_output_length: number;
  };
}

// ─── Domain Tags (for filtering) ──────────────────────────────────────────

export type ActionDomain = 'shared' | 'ttrpg' | 'study';

export const ACTION_DOMAINS: Record<ActionType, ActionDomain> = {
  // Shared
  narration: 'shared',
  speech: 'shared',
  question: 'shared',
  quiz: 'shared',
  highlight: 'shared',
  timer: 'shared',
  progress: 'shared',
  // TTRPG
  scene_transition: 'ttrpg',
  dice_roll: 'ttrpg',
  initiative: 'ttrpg',
  combat_round: 'ttrpg',
  map_reveal: 'ttrpg',
  npc_action: 'ttrpg',
  inventory_change: 'ttrpg',
  ambient: 'ttrpg',
  character_update: 'ttrpg',
  flashback: 'ttrpg',
  // Study
  slide: 'study',
  whiteboard: 'study',
  code_block: 'study',
  interactive: 'study',
  flashcard: 'study',
  spaced_review: 'study',
  exercise: 'study',
  reference: 'study',
};

/** Blocking actions (pipeline waits for completion before next action) */
export const BLOCKING_ACTIONS: ReadonlySet<ActionType> = new Set([
  'speech', 'question', 'quiz', 'combat_round', 'exercise',
]);

// ─── Type Guards ──────────────────────────────────────────────────────────

export function isAction(value: unknown): value is Action {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'payload' in value &&
    typeof (value as Action).type === 'string'
  );
}

export function isBlocking(action: Action): boolean {
  return BLOCKING_ACTIONS.has(action.type);
}

export function getDomain(action: Action): ActionDomain {
  return ACTION_DOMAINS[action.type];
}

export function filterByDomain(actions: Action[], domain: ActionDomain): Action[] {
  return actions.filter((a) => ACTION_DOMAINS[a.type] === domain || ACTION_DOMAINS[a.type] === 'shared');
}

// ─── Frontend Renderer Types ──────────────────────────────────────────────

import type { Component } from 'preact';

/** Map of action types to their rendering components */
export type ActionComponentMap = {
  [K in ActionType]?: Component<{ action: Extract<Action, { type: K }> }>;
};

/** Renderer configuration */
export interface ActionRendererConfig {
  /** Component map for action types */
  components: ActionComponentMap;
  /** Fallback component for unknown types */
  fallback?: Component<{ action: Action }>;
  /** Default animation duration in ms */
  animation_duration_ms?: number;
  /** Maximum concurrent blocking actions */
  max_blocking?: number;
}

/** Render state for a single action */
export interface ActionRenderState {
  action: Action;
  status: 'pending' | 'rendering' | 'completed' | 'error' | 'expired';
  element?: HTMLElement;
  started_at?: number;
  completed_at?: number;
  error?: string;
}
```

---

## 3. SSE Streaming Protocol

### 3.1 Overview

Actions stream from the backend via Server-Sent Events (SSE). This is the same pattern OpenMAIC uses successfully. SSE is preferred over WebSocket for this use case because:
- Unidirectional flow (server → client) matches our data model
- Auto-reconnection built into the browser's EventSource API
- Works through Cloudflare's HTTP proxy without special configuration
- Simpler to implement on Cloudflare Workers (just a streaming Response)

### 3.2 Message Format

```
event: action_start
data: {"id":"act_001","type":"narration"}

event: action_delta
data: {"id":"act_001","path":"payload.text","value":"The ancient "}

event: action_delta
data: {"id":"act_001","path":"payload.text","value":"door creaks open..."}

event: action_complete
data: {"id":"act_001"}

event: action_start
data: {"id":"act_002","type":"dice_roll","payload":{"notation":"1d20","rolls":[17],"modifier":3,"total":20,"reason":"Perception check","critical":"success","rolled_by":"player","animation":"3d_bounce","color":"#ffd700"}}

event: action_complete
data: {"id":"act_002"}

event: session_end
data: {"usage":{"prompt_tokens":2450,"completion_tokens":890,"total_tokens":3340}}
```

### 3.3 Event Types

| Event | Direction | Description |
|-------|-----------|-------------|
| `action_start` | S→C | Announces a new action with its type. May include partial payload. |
| `action_delta` | S→C | Incremental JSON patch for a streaming action (narration text, speech text). |
| `action_complete` | S→C | Marks an action as fully received. Client can now render. |
| `action_error` | S→C | An action failed to parse or generate. Includes recovery info. |
| `session_meta` | S→C | Session-level metadata (session_id, domain, turn). |
| `session_end` | S→C | All actions sent. Includes usage stats. |
| `backpressure` | C→S (HTTP POST) | Client signals readiness for more actions. |
| `user_response` | C→S (HTTP POST) | Client sends user's answer to question/quiz. |

### 3.4 Action Chunking Strategy

**Small actions** (dice_roll, highlight, timer, progress, ambient, character_update):
- Sent as a single `action_start` event with complete payload.
- Followed immediately by `action_complete`.
- Total: 2 SSE events per action.

**Streaming actions** (narration, speech, code_block):
- `action_start` with type only.
- Multiple `action_delta` events with JSON patches.
- `action_complete` when done.
- Client uses `partial-json` + `jsonrepair` (same as OpenMAIC) for robust partial parsing.

**Complex actions** (combat_round, exercise, map_reveal):
- `action_start` with partial payload structure.
- Additional `action_delta` events fill in sub-fields.
- `action_complete` when fully received.

```typescript
// Client-side action accumulator
interface PendingAction {
  id: string;
  type: ActionType;
  payload: Record<string, unknown>;
  buffer: string;
  complete: boolean;
}

function applyDelta(pending: PendingAction, delta: { path: string; value: string }): void {
  // For text fields, append to buffer (markdown/text streaming)
  if (delta.path.endsWith('.text') || delta.path.endsWith('.code')) {
    const current = getNestedValue(pending.payload, delta.path) || '';
    setNestedValue(pending.payload, delta.path, current + delta.value);
    pending.buffer += delta.value;
  }
  // For object fields, merge
  else {
    pending.payload[delta.path] = delta.value;
  }
}
```

### 3.5 Backpressure

The client sends backpressure signals via a separate HTTP POST endpoint:

```
POST /api/session/:id/backpressure
Content-Type: application/json

{
  "ready": true,
  "completed_action_ids": ["act_001", "act_002"],
  "render_queue_depth": 2
}
```

The backend uses this to:
1. Pace action emission (don't flood the client).
2. Decide when to start generating the next action.
3. Detect if the client has disconnected.

On Workers, this is stateless — the backpressure POST is handled separately from the SSE stream. For stateful sessions (TTRPG combat), a Durable Object holds the queue and emits actions based on backpressure signals.

### 3.6 Error Handling

**Malformed action recovery:**
```
event: action_error
data: {"id":"act_003","type":"dice_roll","error":"missing_required_field","field":"rolls","recovery":"skip"}
```

Recovery strategies (sent in the event):
- `skip` — Drop this action, continue with next.
- `retry` — Backend re-generates the action.
- `fallback` — Use a simplified version of the action.
- `abort` — Stop the entire stream.

Client behavior on malformed events:
1. Parse error → log warning, discard event, continue reading stream.
2. Action error with `recovery: "skip"` → show brief error toast, continue.
3. Action error with `recovery: "abort"` → show error modal, allow retry.
4. Connection drop → EventSource auto-reconnects. Client replays completed action IDs via backpressure to avoid duplicates.

---

## 4. Frontend Rendering Pipeline

### 4.1 Architecture Overview

```
SSE Stream
    │
    ▼
ActionAccumulator ──── accumulates deltas into complete actions
    │
    ▼
ActionQueue ─────────── priority queue with blocking awareness
    │
    ├──→ ActionRenderer ─── maps action.type → Preact component
    │         │
    │         ▼
    │    AnimationController ─── manages enter/exit transitions
    │
    └──→ StateManager ──── extracts state from actions (HP, inventory, etc.)
              │
              ▼
         SessionStore (signals) ─── global reactive state
```

### 4.2 ActionAccumulator

Receives SSE events and assembles complete actions:

```typescript
class ActionAccumulator {
  private pending = new Map<string, PendingAction>();
  private onComplete: (action: Action) => void;
  private onError: (id: string, error: ActionError) => void;

  handleEvent(event: SSEEvent): void {
    switch (event.type) {
      case 'action_start':
        this.pending.set(event.data.id, {
          id: event.data.id,
          type: event.data.type,
          payload: event.data.payload || {},
          buffer: '',
          complete: false,
        });
        break;

      case 'action_delta':
        const pending = this.pending.get(event.data.id);
        if (pending) applyDelta(pending, event.data);
        // Emit partial action for live text rendering
        this.onPartial?.(pending.id, pending.payload);
        break;

      case 'action_complete':
        const completed = this.pending.get(event.data.id);
        if (completed) {
          completed.complete = true;
          this.pending.delete(event.data.id);
          this.onComplete(completed as unknown as Action);
        }
        break;

      case 'action_error':
        this.onError(event.data.id, event.data);
        this.pending.delete(event.data.id);
        break;
    }
  }
}
```

### 4.3 ActionQueue

Priority queue that respects blocking actions:

```typescript
class ActionQueue {
  private queue: Array<{ action: Action; priority: number }> = [];
  private blocking = false;
  private activeBlocking: string | null = null;

  enqueue(action: Action): void {
    const priority = action.meta?.priority ?? 5;
    const idx = this.queue.findIndex((a) => a.priority < priority);
    if (idx === -1) this.queue.push({ action, priority });
    else this.queue.splice(idx, 0, { action, priority });
  }

  dequeue(): Action | null {
    if (this.blocking) return null;
    const item = this.queue.shift();
    if (item && isBlocking(item.action)) {
      this.blocking = true;
      this.activeBlocking = item.action.meta?.id;
    }
    return item?.action ?? null;
  }

  complete(actionId: string): void {
    if (this.activeBlocking === actionId) {
      this.blocking = false;
      this.activeBlocking = null;
    }
  }

  get pending(): number { return this.queue.length; }
  get isBlocked(): boolean { return this.blocking; }
}
```

### 4.4 ActionRenderer

Maps action types to Preact components. Uses the existing component infrastructure (HTM + CSS custom properties):

```typescript
import { h, render } from 'preact';
import { html } from 'htm/preact';

// Component registry
const ACTION_COMPONENTS: ActionComponentMap = {
  narration: NarrationView,
  speech: SpeechBubble,
  question: QuestionPrompt,
  quiz: QuizCard,
  highlight: HighlightOverlay,
  timer: TimerWidget,
  progress: ProgressBar,
  // TTRPG
  scene_transition: SceneTransitionView,
  dice_roll: DiceRollView,
  initiative: InitiativeTracker,
  combat_round: CombatLog,
  map_reveal: MapCanvas,
  npc_action: NpcActionView,
  inventory_change: InventoryUpdate,
  ambient: AmbientController,
  character_update: CharacterSheet,
  flashback: FlashbackOverlay,
  // Study
  slide: SlideView,
  whiteboard: WhiteboardCanvas,
  code_block: CodeView,
  interactive: InteractiveWidget,
  flashcard: FlashcardView,
  spaced_review: SpacedReviewCard,
  exercise: ExerciseView,
  reference: ReferenceCard,
};

function ActionRenderer({ action }: { action: Action }) {
  const Component = ACTION_COMPONENTS[action.type];
  if (!Component) {
    return html`<div class="action-unknown">Unknown action: ${action.type}</div>`;
  }
  return html`<${Component} action=${action} />`;
}
```

### 4.5 AnimationController

Manages enter/exit animations using CSS transitions and the Web Animations API:

```typescript
class AnimationController {
  private activeAnimations = new Map<string, Animation>();

  async enter(element: HTMLElement, action: Action): Promise<void> {
    const duration = 300; // ms default
    const animation = element.animate([
      { opacity: 0, transform: 'translateY(10px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration, easing: 'ease-out', fill: 'forwards' });

    this.activeAnimations.set(action.meta?.id || '', animation);
    await animation.finished;
  }

  async exit(element: HTMLElement, actionId: string): Promise<void> {
    const existing = this.activeAnimations.get(actionId);
    if (existing) existing.cancel();

    const animation = element.animate([
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-10px)' },
    ], { duration: 200, easing: 'ease-in', fill: 'forwards' });

    this.activeAnimations.set(actionId, animation);
    await animation.finished;
    element.remove();
  }
}
```

### 4.6 StateManager

Extracts and maintains session state from actions. In TTRPG mode, this tracks the game state; in study mode, this tracks learning progress.

```typescript
interface SessionState {
  // TTRPG
  currentScene: string | null;
  characters: Map<string, CharacterState>;
  initiative: InitiativeState | null;
  combat: CombatState | null;
  inventory: Map<string, InventoryItem[]>;
  timers: Map<string, TimerState>;

  // Study
  currentSlide: number;
  totalSlides: number;
  quizScores: Map<string, QuizResult>;
  flashcardStates: Map<string, FlashcardState>;
  exercisesCompleted: string[];
  reviewSchedule: Map<string, SpacedReviewPayload>;
}

class StateManager {
  private state: SessionState;
  private onChange: (state: SessionState) => void;

  processAction(action: Action): void {
    switch (action.type) {
      case 'scene_transition':
        this.state.currentScene = action.payload.scene_id;
        break;
      case 'character_update':
        this.updateCharacter(action.payload);
        break;
      case 'dice_roll':
        // Log to combat state if in combat
        break;
      case 'inventory_change':
        this.updateInventory(action.payload);
        break;
      case 'slide':
        this.state.currentSlide = action.payload.slide_number;
        this.state.totalSlides = action.payload.total_slides;
        break;
      case 'quiz':
        // Prepare quiz state
        break;
      case 'spaced_review':
        this.state.reviewSchedule.set(action.payload.card_id, action.payload);
        break;
      case 'progress':
        // Update progress tracking
        break;
      // ... other stateful actions
    }
    this.onChange(this.state);
  }
}
```

---

## 5. Cloudflare Workers Compatibility

### 5.1 Integration with Existing Hono Worker

The action system extends the existing Hono worker with new routes:

```typescript
// Existing routes: /api/chat, /api/sessions, /api/feedback
// New routes:

app.post('/api/action/session', async (c) => {
  // Create a new action session (returns session_id + Durable Object stub)
});

app.post('/api/action/:sessionId/stream', async (c) => {
  // Returns SSE stream of actions
  // For study: stateless, generates actions from prompt + context
  // For TTRPG: routes to Durable Object for stateful session
});

app.post('/api/action/:sessionId/respond', async (c) => {
  // User response to question/quiz
});

app.post('/api/action/:sessionId/backpressure', async (c) => {
  // Client readiness signal
});
```

### 5.2 Memory Constraints

Workers have 128MB memory limit. Key considerations:

| Concern | Strategy |
|---------|----------|
| Action payload size | Cap individual actions at 64KB. Stream large content (narration, code) via deltas. |
| Action queue depth | Max 50 pending actions in Durable Object. Backpressure prevents overflow. |
| State size | Store session state in D1 (TTRPG) or KV (study). Keep < 1MB in DO memory. |
| Model output | Stream directly to SSE — never buffer full AgentOutput in memory. |
| Concurrent sessions | Stateless study sessions scale via Workers. TTRPG sessions use DOs (1 DO per session). |

### 5.3 Streaming Response

```typescript
// Worker handler for action streaming
async function streamActions(c: Context): Promise<Response> {
  const sessionId = c.req.param('sessionId');
  const body = await c.req.json();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Send session metadata
      controller.enqueue(encoder.encode(
        `event: session_meta\ndata: ${JSON.stringify({ session_id: sessionId })}\n\n`
      ));

      // Stream from AI model
      const modelStream = await callModel(body.messages, body.config);

      for await (const chunk of modelStream) {
        const events = parseActionEvents(chunk);
        for (const event of events) {
          controller.enqueue(encoder.encode(
            `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`
          ));
        }
      }

      controller.enqueue(encoder.encode(
        `event: session_end\ndata: ${JSON.stringify({ done: true })}\n\n`
      ));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

### 5.4 Durable Objects for Stateful Sessions

**Study sessions**: Stateless. Client sends full context with each request. No DO needed.

**TTRPG sessions**: Stateful. A Durable Object maintains:
- Current scene, characters, initiative, combat state
- Action history (for backtrack/undo)
- Backpressure state
- WebSocket-like connection management (via Durable Object alarm + HTTP polling)

```typescript
export class GameSession extends DurableObject {
  private state: SessionState;
  private actionQueue: Action[] = [];
  private lastBackpressure = 0;

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/stream')) {
      return this.handleStream(request);
    }
    if (url.pathname.endsWith('/respond')) {
      return this.handleResponse(request);
    }
    if (url.pathname.endsWith('/backpressure')) {
      return this.handleBackpressure(request);
    }
    if (url.pathname.endsWith('/state')) {
      return this.handleGetState();
    }
  }

  private async handleStream(request: Request): Promise<Response> {
    // Merge stored state with request context
    // Send to AI model
    // Stream actions back
    // Update stored state from action payloads
  }
}
```

DO storage limits (Durable Object storage): 128GB per namespace. Individual state objects kept < 1MB. Full session history stored in D1 for persistence across DO restarts.

---

## 6. Devil's Advocate

### 6.1 Is interleaved JSON the right format?

**Alternatives considered:**

| Format | Pros | Cons |
|--------|------|------|
| **Interleaved JSON (chosen)** | Proven in OpenMAIC; human-readable; easy to debug; works with SSE | Verbose; requires JSON parsing on every chunk |
| **SSE with typed events only** | Cleaner protocol; no parsing needed | Loses action structure; harder to version; doesn't capture action relationships |
| **WebSocket binary (MessagePack)** | Compact; low latency; bidirectional | Requires binary protocol handling; harder to debug; no auto-reconnect; proxy issues on CF |
| **Protobuf** | Schema-enforced; very compact | Code generation required; not human-readable; overkill for our throughput |

**Verdict**: Interleaved JSON over SSE is the right call for V1. The verbosity cost is negligible (< 1KB per action) compared to the debugging and development speed gains. WebSocket binary becomes interesting only if we exceed 100 actions/second per session (unlikely for TTRPG/study).

**Future path**: If performance becomes an issue, we can add a `Content-Encoding: gzip` layer or switch individual action deltas to MessagePack while keeping the SSE framing.

### 6.2 Human-readable or binary for performance?

Keep human-readable. Our bottleneck is **LLM generation latency** (1-5 seconds per action), not network serialization. A 64KB JSON action serializes in < 1ms. Binary serialization saves maybe 50-100µs — irrelevant when the model takes seconds.

The only scenario where binary matters: the whiteboard drawing stream (many small coordinate updates). We can optimize this later with delta encoding without changing the protocol.

### 6.3 Action conflicts (two agents speaking simultaneously)?

**Problem**: In multi-agent TTRPG, the Director might dispatch two NPCs to speak at the same time.

**Solution**: Priority-based serialization in the ActionQueue.

1. Each action has `meta.priority` (0-10). Default: 5.
2. The Director assigns priorities when generating actions.
3. The ActionQueue only dequeues one action at a time.
4. If a blocking action (speech, question) is active, all others wait.
5. The Director is instructed (via system prompt) to never assign high priority to two speech actions in the same batch.

**Fallback**: If the frontend receives two speech actions simultaneously:
- Render the higher-priority one first.
- Queue the second with a "speaking" indicator.
- After the first completes, auto-advance to the second.

### 6.4 Latency budget: actions per second on Workers?

**Measured constraints:**

| Component | Latency |
|-----------|----------|
| Worker cold start | ~50ms (if not already warm) |
| Worker request routing | ~5ms |
| D1 query (read session state) | ~10ms |
| AI model call (first token) | 500ms-3s |
| AI model call (per token) | ~20ms |
| SSE event serialization | < 1ms |
| Network (client ↔ CF edge) | 10-100ms (varies) |

**Practical throughput:**
- **Non-blocking actions** (highlight, timer, progress): Can process 100+/second. No bottleneck.
- **Blocking actions** (speech, narration): Limited by TTS + reading time. Typically 1 every 5-15 seconds.
- **Complex actions** (combat_round, map_reveal): Limited by model generation. 1 every 3-10 seconds.

**Realistic session profile:**
- Study session: ~20-40 actions per hour (mostly slides, quizzes, narration).
- TTRPG session: ~40-80 actions per hour (more varied, includes combat sequences).

Workers can comfortably handle this. Even 100 concurrent sessions at 80 actions/hour = ~2.2 actions/second aggregate — trivial for CF Workers.

**The real bottleneck**: LLM API rate limits and latency, not Worker execution.

---

## 7. Migration Path

### 7.1 Integration with Existing Chat Endpoint

The existing `/v1/chat/completions` endpoint (OpenAI-compatible) continues to work unchanged. The action system is additive.

**Key insight**: The AI can be instructed to output either:
1. Plain text (current behavior) — for simple chat sessions
2. JSON action array — for interactive sessions

The `stream` parameter and SSE framing already exist. We add action-aware parsing on top.

### 7.2 Backward Compatibility Plan

```
Phase 1: Dual Output (Week 1-2)
├── /v1/chat/completions — unchanged (plain text)
├── /v1/chat/completions + header X-Action-Mode: true
│   └── Returns actions interleaved with text deltas
│   └── Client detects action JSON and routes to ActionRenderer
│   └── Falls back to plain text rendering if no actions detected
└── No breaking changes to existing clients

Phase 2: Action-First Protocol (Week 3-4)
├── /api/action/:sessionId/stream — dedicated SSE endpoint
│   └── Pure action stream, no plain text
│   └── Backpressure support
│   └── Durable Objects for TTRPG state
├── /v1/chat/completions — continues working
└── New Preact components: ActionRenderer, ActionQueue, StateManager

Phase 3: Full Interactive (Week 5-8)
├── DMlog.ai frontend uses action-first protocol
├── StudyLog.ai frontend uses action-first protocol
├── Existing chat UI remains as "Simple Mode"
├── Interactive mode becomes the default for new sessions
└── Migration tool: convert old chat sessions to action format
```

### 7.3 Phase 1 Implementation (Simple Action Output)

The minimal viable change: instruct the model to wrap output in a JSON action array, detect it on the client.

**System prompt addition:**
```
When the user is in an interactive session, output your response as a JSON array of actions:
[{"type":"narration","payload":{"text":"..."}}]

If the user is in a regular chat session, respond normally with plain text.
```

**Client-side detection:**
```typescript
function detectActionMode(content: string): { isAction: boolean; actions?: Action[] } {
  const trimmed = content.trim();
  if (trimmed.startsWith('[{') && trimmed.endsWith('}]')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].type) {
        return { isAction: true, actions: parsed };
      }
    } catch {
      // Maybe partial JSON — try jsonrepair
    }
  }
  return { isAction: false };
}
```

**Streaming detection**: If the first non-whitespace characters are `[{`, switch the SSE parser to action accumulation mode. If not, fall back to standard text streaming.

### 7.4 Phase 2 Implementation (Full Action Protocol)

The dedicated action endpoint with proper streaming:

1. **New route**: `POST /api/action/session` creates session, returns `session_id`.
2. **Stream endpoint**: `POST /api/action/:sessionId/stream` accepts messages, returns SSE action stream.
3. **Response endpoint**: `POST /api/action/:sessionId/respond` sends user answers.
4. **Frontend**: New `ActionView` component replaces `Chat` for interactive sessions.
5. **State**: Durable Objects for TTRPG, stateless for study.

### 7.5 Type Extensions to Existing Code

The existing `types.ts` is extended (not modified):

```typescript
// In src/types.ts — append new types at the bottom:

// ─── Action System (added for interactive mode) ─────────────────────────
// Full action types imported from src/actions/types.ts
// These are only used when session mode is 'interactive'
```

This ensures existing chat functionality is completely unaffected.

---

## Appendix A: Quick Reference — Action Type Matrix

| Type | Domain | Blocking | Streamable | State Impact |
|------|--------|----------|------------|--------------|
| narration | shared | ❌ | ✅ (text) | None |
| speech | shared | ✅ | ✅ (text) | None |
| question | shared | ✅ | ❌ | Awaits input |
| quiz | shared | ✅ | ❌ | Score tracking |
| highlight | shared | ❌ | ❌ | None |
| timer | shared | ❌ | ❌ | Timer state |
| progress | shared | ❌ | ❌ | Progress |
| scene_transition | ttrpg | ✅ | ❌ | Current scene |
| dice_roll | ttrpg | ❌ | ❌ | Combat log |
| initiative | ttrpg | ❌ | ❌ | Turn order |
| combat_round | ttrpg | ✅ | ✅ (turns) | HP, conditions |
| map_reveal | ttrpg | ❌ | ❌ | Map state |
| npc_action | ttrpg | ❌ | ❌ | NPC state |
| inventory_change | ttrpg | ❌ | ❌ | Inventory |
| ambient | ttrpg | ❌ | ❌ | Audio state |
| character_update | ttrpg | ❌ | ❌ | Character stats |
| flashback | ttrpg | ✅ | ✅ (narration) | None |
| slide | study | ❌ | ❌ | Slide position |
| whiteboard | study | ✅ | ✅ (items) | Canvas state |
| code_block | study | ❌ | ✅ (code) | None |
| interactive | study | ❌ | ❌ | Widget state |
| flashcard | study | ✅ | ❌ | Card state |
| spaced_review | study | ❌ | ❌ | Review schedule |
| exercise | study | ✅ | ❌ | Exercise progress |
| reference | study | ❌ | ❌ | None |

## Appendix B: Example Session Flows

### TTRPG Session — Entering Combat

```json
[
  { "type": "ambient", "payload": { "cue_id": "combat-music", "action": "play", "volume": 0.5, "category": "music", "fade_ms": 1500 } },
  { "type": "narration", "payload": { "text": "## Combat Begins!\n\nThe goblins spring from the shadows, rusty blades gleaming.", "style": "dramatic" } },
  { "type": "initiative", "payload": { "action": "set", "order": [...], "round": 1, "current_turn": 0 } },
  { "type": "speech", "payload": { "character": "Goblin Scout", "character_id": "npc-goblin-1", "text": "Grrrk! Attack!" } },
  { "type": "dice_roll", "payload": { "notation": "1d20+4", "rolls": [12], "modifier": 4, "total": 16, "reason": "Goblin scimitar attack", "character_id": "npc-goblin-1", "rolled_by": "npc" } },
  { "type": "question", "payload": { "prompt": "The goblin attacks you for 6 slashing damage! What's your move?", "valid_answers": ["Attack back", "Dodge", "Cast spell", "Use item"] } }
]
```

### Study Session — Teaching Binary Search

```json
[
  { "type": "slide", "payload": { "slide_number": 1, "total_slides": 5, "title": "Binary Search", "layout": "title_content", "content": "Binary search finds an item in **O(log n)** time." } },
  { "type": "speech", "payload": { "character": "Your Tutor", "character_id": "tutor-1", "text": "Let's understand how binary search halves the search space each step." } },
  { "type": "whiteboard", "payload": { "action": "draw", "items": [{"type": "text", "text": "[1, 3, 5, 7, 9, 11, 13]", "x": 100, "y": 100}] } },
  { "type": "interactive", "payload": { "id": "bs-viz", "title": "Try it yourself", "widget_type": "html", "source": "..." } },
  { "type": "quiz", "payload": { "id": "q-bs-1", "question": "What is the time complexity of binary search?", "type": "single", "options": [...], "correct_answer": ["B"] } }
]
```
