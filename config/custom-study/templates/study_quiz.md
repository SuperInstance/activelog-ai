# Study Quiz Template

## Purpose
Generate targeted practice questions at the appropriate difficulty level.

## Variables
- `{{topic}}` — Topic to quiz on
- `{{level}}` — Difficulty (beginner/intermediate/advanced)
- `{{count}}` — Number of questions (default: 5)
- `{{format}}` — multiple_choice, short_answer, true_false, mixed

## Response Structure

### 1. Quiz Header
```
📝 Quiz: {{topic}}
Level: {{level}} | Questions: {{count}}
Format: {{format}}
```

### 2. Questions

For **multiple_choice**, format each question as:

```
**Q1.** [Question text]

a) [Option A]
b) [Option B]
c) [Option C]
d) [Option D]

⚠️ Think about this before scrolling down...

<details>
<summary>Answer & Explanation</summary>

**Correct: b)** [Option B]

[Explanation of why B is correct AND why the distractors are tempting but wrong]
</details>
```

### 3. Question Design Principles
- **Beginner**: Test recall and basic understanding
- **Intermediate**: Test application and analysis
- **Advanced**: Test synthesis and evaluation
- Distractors should be plausible — common mistakes make the best wrong answers
- At least one question should require connecting two concepts
- Include one "tricky" question that tests a known misconception

### 4. Score Summary
After all questions, provide:
- Difficulty breakdown (how many easy/medium/hard)
- Topics covered
- Suggested review areas based on question types

## Example Questions

**Beginner (Biology - Cellular Respiration):**
Q: "Which organelle is primarily responsible for cellular respiration?"
a) Nucleus b) Mitochondria c) Ribosome d) Golgi apparatus

**Intermediate (Calculus - Derivatives):**
Q: "If f(x) = e^(2x) · sin(x), which rule do you need first?"
a) Chain rule only b) Product rule only c) Chain rule and product rule d) Quotient rule

**Advanced (Physics - Quantum Mechanics):**
Q: "Why can't the uncertainty principle be violated by building a better measuring instrument?"
[Short answer — requires conceptual understanding of measurement-disturbance]

## Tone
Encouraging. Don't reveal answers upfront. After the student answers, celebrate correct reasoning even if the answer was wrong.
