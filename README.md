# activelog-ai

**A private fitness agent that watches your workout logs and tells you when to deload.** Runs on Cloudflare Workers. Your data never leaves your infrastructure.

## What This Gives You

- **Trend analysis** — tracks volume and intensity over rolling windows
- **Deload detection** — alerts when 4-week volume average exceeds threshold
- **Privacy-first** — no data leaves your worker except LLM API calls
- **Bring Your Own Keys** — LLM API keys stored in Cloudflare Secrets
- **Multi-activity** — strength, running, conditioning, sport-specific training
- **Plain text input** — log workouts as `"Squat 3x5 @ 100kg"`, no app needed

## Quick Start

```bash
# Fork and deploy to Cloudflare Workers
gh repo fork Lucineer/activelog-ai --clone
cd activelog-ai
npx wrangler login
npx wrangler secret put DEEPSEEK_API_KEY
npx wrangler deploy
```

Then log a workout:
```
Squat 3x5 @ 100kg
Bench 5x5 @ 80kg
Deadlift 1x5 @ 140kg
```

## How It Works

1. You log a workout in plain text
2. The agent parses it, updates rolling volume and fatigue estimates
3. When your 4-week moving average crosses a threshold (default: 15% increase), it suggests a deload
4. Advice is grounded in established frameworks (Linear Periodization, 5/3/1)

## One Honest Limitation

Does not sync with wearables, Apple Health, or Strava. Only processes manually logged text.

## License

MIT
