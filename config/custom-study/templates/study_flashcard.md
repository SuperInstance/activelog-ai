# Study Flashcard Template

## Purpose
Create spaced-repetition flashcards optimized for long-term retention.

## Variables
- `{{topic}}` — Topic for flashcards
- `{{count}}` — Number of cards (default: 10)
- `{{source}}` — Textbook or material reference

## Response Structure

### 1. Deck Header
```
🃏 Flashcard Deck: {{topic}}
Cards: {{count}} | Source: {{source}}
```

### 2. Card Format

Each card follows this structure:

```markdown
---
**FRONT:** [Question or prompt]

**BACK:** [Answer or definition]

**Hint:** [Optional clue for when they're stuck]

**Context:** [Why this matters / when they'll use it]

**Difficulty:** ⭐/⭐⭐/⭐⭐⭐

**Related Cards:** [Numbers of connected cards in this deck]
---
```

### 3. Card Types
Mix these for effective decks:

**Definition Cards** (~30%)
- Front: "What is [term]?"
- Back: Precise definition + key attributes

**Process Cards** (~25%)
- Front: "What are the steps to [process]?"
- Back: Ordered steps with brief explanations

**Application Cards** (~25%)
- Front: "When would you use [concept] instead of [alternative]?"
- Back: Decision criteria with example scenario

**Connection Cards** (~20%)
- Front: "How does [concept A] relate to [concept B]?"
- Back: Relationship explanation + why the connection matters

### 4. Example Cards

```markdown
---
**FRONT:** What is the difference between mitosis and meiosis?

**BACK:**
| Feature | Mitosis | Meiosis |
|---------|---------|---------|
| Divisions | 1 | 2 |
| Daughter cells | 2 (identical) | 4 (unique) |
| Purpose | Growth/repair | Gamete production |
| Crossing over | No | Yes (Prophase I) |

**Hint:** Think about whether the result needs to be a clone or something new.

**Context:** Tested heavily in AP Bio and MCAT — know the table cold.

**Difficulty:** ⭐⭐

**Related Cards:** 3, 7
---
```

### 5. Review Schedule Suggestion
End with a suggested review schedule based on the number and difficulty:
- Day 1: Review all ⭐ cards
- Day 2: Review all ⭐⭐ cards + missed ⭐
- Day 4: Review all ⭐⭐⭐ cards + missed ⭐⭐
- Day 7: Full deck review

## Guidelines
- Each card should test ONE concept
- Front should be answerable in <30 seconds
- Back should be concise enough to recall, not read like a paragraph
- Include mnemonics where natural
- Number cards sequentially for cross-referencing
