# Study Schedule Template

## Purpose
Create realistic, effective study schedules with spaced repetition built in.

## Variables
- `{{exams}}` — Upcoming exams or deadlines
- `{{subjects}}` — Subjects to cover
- `{{timeframe}}` — Available study period
- `{{hours_per_day}}` — Available study hours per day
- `{{weak_areas}}` — Known weak areas to prioritize

## Response Structure

### 1. Assessment
```
📚 Study Schedule Generator
Timeframe: {{timeframe}}
Available: {{hours_per_day}}h/day
Exams: {{exams}}
Priority Areas: {{weak_areas}}
```

### 2. Priority Matrix
Rank subjects by urgency × difficulty:

```
Subject    | Days Until | Difficulty | Priority | Hours/Day
-----------|------------|------------|----------|----------
[Subject]  | [##]       | High       | 🔴       | [##]
[Subject]  | [##]       | Medium     | 🟡       | [##]
[Subject]  | [##]       | Low        | 🟢       | [##]
```

### 3. Daily Schedule Template
```markdown
## [Day #] — [Date] — [Focus Theme]

### Morning Block (2h)
| Time     | Subject          | Activity              | Method        |
|----------|------------------|-----------------------|---------------|
| 9:00-9:50| [Subject]        | Review [topic]        | Active recall |
| 10:00-10:50| [Subject]      | Practice problems     | Problem sets  |
| 11:00-11:50| [Subject]      | Weak area focus       | Socratic Q&A  |

### Afternoon Block (2h)
| Time     | Subject          | Activity              | Method        |
|----------|------------------|-----------------------|---------------|
| 1:00-1:50| [Subject]        | New material          | Concept maps  |
| 2:00-2:50| [Subject]        | Practice exam Q's     | Timed quiz    |

### Evening Review (30min)
| Time     | Activity                | Method            |
|----------|-------------------------|-------------------|
| 8:00-8:30| Flashcard review (all)  | Spaced repetition |
```

### 4. Spaced Repetition Schedule
Built into each day:
- **Day 1 topics**: Reviewed on Days 2, 4, 7, 14
- **Day 2 topics**: Reviewed on Days 3, 6, 12
- Use expanding intervals — never let a topic go more than 7 days without review

### 5. Study Methods by Phase
```
Phase 1 (Days 1-3): Learn & Understand
  → Concept explanations, worked examples, analogies
  
Phase 2 (Days 4-6): Practice & Apply
  → Problem sets, practice exams, flashcards
  
Phase 3 (Days 7-8): Review & Solidify
  → Mixed practice, teach-back method, weak areas
  
Phase 4 (Day before): Light Review
  → Flashcards only, early bedtime, confidence building
```

### 6. Break Schedule
- Pomodoro: 50min study / 10min break
- After 3 pomodoros: 30min break
- Lunch break: 1 hour
- No studying after the schedule ends — recovery matters for memory consolidation

### 7. Daily Check-in Questions
Each morning, ask:
1. "What did you struggle with most yesterday?"
2. "What topic do you feel most confident about?"
3. "What's the one thing you need to nail today?"

## Example Output

```
📅 7-Day Finals Study Plan
Exams: Calculus (Mon), Bio (Wed), History (Fri)
Hours/day: 6h
Weak areas: Integration by parts, Cellular respiration, WWII diplomacy

Day 1 (Sat): Calculus fundamentals + Bio cellular processes
Day 2 (Sun): Calculus integration techniques + Bio genetics  
Day 3 (Mon): [CALC EXAM] + History review begins
Day 4 (Tue): History WWII + Bio review
Day 5 (Wed): [BIO EXAM] + History deep dive
Day 6 (Thu): History essay practice + light calc/bio review
Day 7 (Fri): [HISTORY EXAM] 🎉
```

## Tone
Practical and encouraging. Acknowledge that plans change — build in flexibility. Celebrate consistency over perfection.
