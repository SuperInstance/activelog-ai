# UX Design — log-origin

> User experience design for the log-origin AI gateway: personas, interaction model,
> component architecture, wireframes, and accessibility.

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Personas](#2-personas)
3. [Developer Experience (DX)](#3-developer-experience-dx)
4. [Information Architecture](#4-information-architecture)
5. [Interaction Model](#5-interaction-model)
6. [ASCII Wireframes](#6-ascii-wireframes)
7. [Theming](#7-theming)
8. [Keyboard Shortcuts](#8-keyboard-shortcuts)
9. [Accessibility (WCAG AA)](#9-accessibility-wcag-aa)
10. [Error States](#10-error-states)
11. [Component Architecture](#11-component-architecture)
12. [Devil's Advocate](#12-devils-advocate)
13. [Open Questions](#13-open-questions)

---

## 1. Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Fast to first value** | <30s from `npm install` to first API call; 3-line config |
| **Minimal chrome** | Chat takes 90%+ of screen; settings are overlays, not pages |
| **Progressive disclosure** | Start with simple chat; draft mode, metrics, routing exposed on demand |
| **Dark by default** | Technical audience prefers dark mode; light mode as alternative |
| **Keyboard-first** | All actions accessible via keyboard; mouse is optional |
| **Mobile-responsive** | Chat works on phone; settings optimized for desktop |
| **No build step for UI** | Preact + HTM, shipped as static assets in Worker |

---

## 2. Personas

### Developer Dan
- **Role:** Software engineer, wants AI for coding tasks
- **Tech level:** High — comfortable with APIs, CLI, environment variables
- **Goals:** Fast setup, reliable routing to cheap models for mundane tasks, escalation to quality for complex code
- **Pain points:** Spending $50+/month on OpenAI for tasks that a $2 model handles fine
- **Primary feature:** Routing intelligence — "save me money without me thinking about it"
- **Installation:** `npm install @logai/core` + `wrangler deploy`

### Power User Pat
- **Role:** AI power user, compares models daily
- **Tech level:** Medium — can configure API keys, prefers GUI
- **Goals:** Compare responses from multiple providers, track which performs best for their use cases
- **Pain points:** Switching between ChatGPT, Claude, DeepSeek is tedious; no way to compare side-by-side
- **Primary feature:** Draft mode — "show me all options, I'll pick the best"
- **Installation:** Fork repo, deploy via web UI

### Casual Casey
- **Role:** Uses AI for everyday tasks (emails, summarization, brainstorming)
- **Tech level:** Low — wants a simple chat interface
- **Goals:** Just chat with AI; doesn't care which model handles it
- **Pain points:** Too many AI tools, confused by model selection
- **Primary feature:** "It just works" — automatic routing, no configuration needed
- **Installation:** Uses a hosted instance or someone else's deployment

### Admin Alex
- **Role:** Manages AI gateway for a small team or family
- **Tech level:** Medium-High — comfortable with Cloudflare dashboard
- **Goals:** Monitor usage, manage provider keys, control costs, enforce privacy
- **Pain points:** No visibility into which models are being used, how much it costs
- **Primary feature:** Metrics dashboard + provider management
- **Installation:** Deploys for team, shares tunnel URL

---

## 3. Developer Experience (DX)

### Installation

```bash
# Option A: CLI (for Developer Dan)
npm install @logai/core
```

```bash
# Option B: Fork & Deploy (for Power User Pat)
git clone https://github.com/log-ai/log-origin
cd log-origin
npm install
npx wrangler d1 create log-origin-db
npx wrangler deploy
```

### 3-line config

```typescript
import { LogOrigin } from '@logai/core';

const origin = new LogOrigin({
  passphraseHash: 'sha256-of-your-passphrase',
  providers: [{ id: 'deepseek', type: 'openai-compatible', name: 'DeepSeek', model: 'deepseek-chat', roles: ['cheap'] }],
});

// First API call:
const response = await origin.chat('Hello!', 'session-1', []);
```

### <30 seconds to first API call

```
0s    npm install @logai/core
5s    Write 3-line config
10s   npx wrangler d1 create my-db
15s   npx wrangler deploy
20s   Set passphrase in browser
25s   Enter DeepSeek API key (encrypted client-side)
30s   First chat message → response ✓
```

---

## 4. Information Architecture

### Single-page overlay model

The UI is a single page with overlays (modals/drawers) for secondary functionality:

```
┌─────────────────────────────────────────┐
│  Main View (always visible)              │
│  ┌──────────┬──────────────────────────┐ │
│  │ Sidebar  │      Chat Area           │ │
│  │ (toggle) │                          │ │
│  │          │                          │ │
│  │ Sessions │    Messages + Input       │ │
│  │ Agents   │                          │ │
│  │ ──────── │                          │ │
│  │ Settings │                          │ │
│  │ Metrics  │                          │ │
│  └──────────┘                          │ │
└─────────────────────────────────────────┘

Overlays (on top of main view):
  - Login (modal, first visit)
  - Settings (right drawer)
  - Provider Setup (right drawer)
  - Metrics (right drawer)
  - Draft Panel (split view, replaces chat temporarily)
  - Session creation (inline in sidebar)
```

### Navigation

No routing, no URL changes. Everything is state-driven:

```
Login state → Chat view (with sidebar)
  └── Sidebar: Sessions list, Agents, Settings, Metrics
  └── Overlays: Provider setup, Preferences, Draft panel
```

---

## 5. Interaction Model

### Chat flow

```
1. User types message in input field
2. Client-side PII detection runs
3. If PII found: entities replaced with tokens, map encrypted and stored
4. Message sent to Worker (tokenized)
5. Worker routes to provider
6. Response streams back (SSE)
7. Client rehydrates PII tokens
8. User sees response with real PII values
9. Feedback buttons appear on assistant messages
```

### Draft flow

```
1. User types "/draft " prefix or clicks Draft toggle
2. Draft panel opens (split view)
3. System sends to N providers in parallel
4. Provider cards appear as responses arrive
5. Cards show: provider name, model, latency, response preview
6. User clicks a card to expand full response
7. User clicks "Pick Winner" on preferred card
8. Winner stored in session; routing learns from selection
9. Draft panel closes, winning response shown in chat
```

### Settings flow

```
1. Click Settings in sidebar → right drawer opens
2. Sections: Profile, Providers, PII, Routing, Theme
3. Provider setup: click "Add Provider" → form with name, base URL, model
4. API key field: paste key → client-side encrypts → sends ciphertext to Worker
5. Changes save immediately (no "Save" button — auto-save on blur)
```

---

## 6. ASCII Wireframes

### Login

```
┌─────────────────────────────────────────────┐
│                                             │
│                                             │
│              ┌───────────────┐              │
│              │   🔐 log      │              │
│              │   origin      │              │
│              │               │              │
│              │ Passphrase    │              │
│              │ ┌───────────┐ │              │
│              │ │           │ │              │
│              │ └───────────┘ │              │
│              │               │              │
│              │ [  Unlock  ]  │              │
│              │               │              │
│              │ Auto-lock: 15m│              │
│              │ ☐ Stay logged │              │
│              │   in          │              │
│              └───────────────┘              │
│                                             │
└─────────────────────────────────────────────┘
```

### Chat (main view)

```
┌──────────┬──────────────────────────────────┐
│ 📋        │  Session: Invoice email draft    │
│ Sessions  │  ─────────────────────────────  │
│           │                                  │
│ ○ Invoice │  [USER] (10:30)                  │
│ ○ Python  │  Email john@doe.com about the    │
│ ○ Meeting │  invoice #INV-12345              │
│ ● Current ◄│                                  │
│           │  [ASSISTANT] (10:30) · 1.2s      │
│ ──────── │  I'll draft an email to           │
│ ⚙ Settings│  john@doe.com. Here's a draft:    │
│ 📊 Metrics│                                  │
│ 🤖 Agents │  Subject: Invoice #INV-12345      │
│           │  Dear john@doe.com,               │
│           │  I hope this message finds...     │
│           │                                  │
│           │                    👍 👎          │
│           │  ─────────────────────────────  │
│           │  [ Type a message...        ] 📎 │
│           │  [ /draft] [/local] [/compare]   │
└──────────┴──────────────────────────────────┘
```

### Draft mode

```
┌──────────┬──────────────────────────────────┐
│ 📋        │  Draft Round · 3 providers        │
│ Sessions  │  ─────────────────────────────  │
│           │                                  │
│           │  [USER] Write a blog post about   │
│           │  AI privacy                      │
│           │  ─────────────────────────────  │
│           │                                  │
│           │  ┌─────────────┐ ┌─────────────┐│
│           │  │ DeepSeek    │ │ Groq (Llama) ││
│           │  │ ★ WINNER    │ │             ││
│           │  │ 1.2s · 200tk│ │ 0.35s · 180tk│
│           │  │             │ │             ││
│           │  │ AI privacy  │ │ In the age  ││
│           │  │ is one of   │ │ of artifici ││
│           │  │ the most... │ │ al intellig ││
│           │  │             │ │ ence...     ││
│           │  │ [Expand]    │ │ [Expand]    ││
│           │  └─────────────┘ └─────────────┘│
│           │                                  │
│           │  ┌─────────────┐                 │
│           │  │ Workers AI  │                 │
│           │  │ 2.8s · 220tk│                 │
│           │  │             │                 │
│           │  │ Privacy and │                 │
│           │  │ AI: A moder │                 │
│           │  │ n dilemma...│                 │
│           │  │ [Expand]    │                 │
│           │  └─────────────┘                 │
│           │                                  │
│           │  [← Back to Chat]  [Pick Winner]│
└──────────┴──────────────────────────────────┘
```

### Settings (overlay)

```
┌──────────┬────────────────────┬──────────────┐
│ 📋        │ Chat area          │ SETTINGS →  │
│ Sessions  │ (dimmed)           │              │
│           │                    │ ┌──────────┐ │
│           │                    │ │ Providers│ │
│           │                    │ ├──────────┤ │
│           │                    │ │ PII      │ │
│           │                    │ ├──────────┤ │
│           │                    │ │ Routing  │ │
│           │                    │ ├──────────┤ │
│           │                    │ │ Theme    │ │
│           │                    │ ├──────────┤ │
│           │                    │ │ Export   │ │
│           │                    │ └──────────┘ │
│           │                    │              │
│           │                    │ --- PII ---  │
│           │                    │              │
│           │                    │ ☑ Auto-detect│
│           │                    │   PII       │
│           │                    │              │
│           │                    │ ☑ Names      │
│           │                    │ ☑ Emails     │
│           │                    │ ☑ Phone #s   │
│           │                    │ ☑ SSN        │
│           │                    │ ☑ Credit card│
│           │                    │ ☑ API keys   │
│           │                    │              │
│           │                    │ Entities (3) │
│           │                    │ [EMAIL_1] john@doe.com│
│           │                    │ [PERSON_A] Jane Smith   │
│           │                    │ [PHONE_1] (555) 123-4567│
│           │                    │              │
│           │                    │ [Delete Account]│
└──────────┴────────────────────┴──────────────┘
```

### Metrics

```
┌──────────┬────────────────────┬──────────────┐
│ 📋        │ Chat area          │ METRICS →   │
│ Sessions  │ (dimmed)           │              │
│           │                    │ Last 30 days │
│           │                    │ ──────────── │
│           │                    │              │
│           │                    │ 142 msgs     │
│           │                    │ 5 sessions   │
│           │                    │              │
│           │                    │ Routing      │
│           │                    │ ──────────── │
│           │                    │ cheap:     78%│
│           │                    │ escalation:18%│
│           │                    │ compare:    3%│
│           │                    │ local:      1%│
│           │                    │              │
│           │                    │ Providers    │
│           │                    │ ──────────── │
│           │                    │ DeepSeek     │
│           │                    │ ████████ 85% │
│           │                    │ avg 1.2s ↑78%│
│           │                    │              │
│           │                    │ Groq         │
│           │                    │ ██████   70% │
│           │                    │ avg 0.3s ↑70%│
│           │                    │              │
│           │                    │ Feedback     │
│           │                    │ ──────────── │
│           │                    │ 👍 45 (78%)  │
│           │                    │ 👎 13 (22%)  │
│           │                    │              │
│           │                    │ Savings est. │
│           │                    │ ~$12.40/mo   │
└──────────┴────────────────────┴──────────────┘
```

---

## 7. Theming

### CSS custom properties

```css
:root {
  /* Colors */
  --lo-bg-primary: #0d1117;
  --lo-bg-secondary: #161b22;
  --lo-bg-tertiary: #21262d;
  --lo-text-primary: #e6edf3;
  --lo-text-secondary: #8b949e;
  --lo-text-muted: #484f58;
  --lo-accent: #58a6ff;
  --lo-accent-hover: #79c0ff;
  --lo-success: #3fb950;
  --lo-error: #f85149;
  --lo-warning: #d29922;
  --lo-border: #30363d;
  
  /* Typography */
  --lo-font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  --lo-font-mono: 'JetBrains Mono', 'Fira Code', Consolas, monospace;
  --lo-font-size-sm: 0.8125rem;
  --lo-font-size-base: 0.9375rem;
  --lo-font-size-lg: 1.125rem;
  
  /* Spacing */
  --lo-space-xs: 0.25rem;
  --lo-space-sm: 0.5rem;
  --lo-space-md: 1rem;
  --lo-space-lg: 1.5rem;
  --lo-space-xl: 2rem;
  
  /* Layout */
  --lo-sidebar-width: 260px;
  --lo-overlay-width: 360px;
  --lo-border-radius: 8px;
  
  /* Transitions */
  --lo-transition: 150ms ease;
}

/* Light mode */
[data-theme="light"] {
  --lo-bg-primary: #ffffff;
  --lo-bg-secondary: #f6f8fa;
  --lo-bg-tertiary: #eaeef2;
  --lo-text-primary: #1f2328;
  --lo-text-secondary: #656d76;
  --lo-text-muted: #8c959f;
  --lo-border: #d0d7de;
}
```

---

## 8. Keyboard Shortcuts

| Shortcut | Action | Context |
|----------|--------|---------|
| `Enter` | Send message | Input focused |
| `Shift+Enter` | New line in message | Input focused |
| `Ctrl+/` | Toggle sidebar | Anywhere |
| `Ctrl+K` | New session | Anywhere |
| `Ctrl+.` | Toggle settings overlay | Anywhere |
| `Ctrl+D` | Toggle draft mode | Input focused |
| `Ctrl+L` | Toggle local mode | Input focused |
| `Esc` | Close overlay | Overlay open |
| `↑` / `↓` | Navigate sessions | Sidebar focused |
| `Tab` | Accept PII suggestion | Input focused, entity detected |
| `Ctrl+Shift+M` | Toggle metrics | Anywhere |
| `1-9` | Select draft card by number | Draft panel open |

---

## 9. Accessibility (WCAG AA)

### Requirements

| Requirement | Implementation |
|-------------|---------------|
| **Color contrast** | All text meets 4.5:1 ratio (AA) against backgrounds |
| **Focus indicators** | Visible focus rings on all interactive elements (2px solid `--lo-accent`) |
| **Screen reader** | ARIA labels on all buttons, live regions for streaming content |
| **Keyboard nav** | All interactive elements reachable via Tab; no mouse traps |
| **Form labels** | All inputs have associated `<label>` elements |
| **Error identification** | Errors announced via `aria-live="assertive"` |
| **Reduced motion** | Respect `prefers-reduced-motion` for animations |
| **Semantic HTML** | Proper heading hierarchy, landmark regions (`<nav>`, `<main>`, `<aside>`) |

### ARIA live regions

```html
<!-- Streaming response - updates as chunks arrive -->
<div role="log" aria-live="polite" aria-label="AI response">
  <p>...</p>
</div>

<!-- Toast notifications -->
<div role="alert" aria-live="assertive">
  Provider DeepSeek is temporarily unavailable. Using fallback.
</div>
```

### Focus management

```html
<!-- Modal trap: Tab cycles within modal, Esc closes -->
<div role="dialog" aria-modal="true" aria-labelledby="settings-title">
  <!-- First focusable element gets focus on mount -->
  <!-- Last element Tab wraps to first -->
</div>
```

---

## 10. Error States

| Error Type | What User Sees | Recovery |
|-----------|---------------|----------|
| **Invalid passphrase** | "Passphrase is incorrect. Try again." (below input, red text) | Re-enter passphrase |
| **Passphrase locked** | "Too many attempts. Try again in 60 seconds." | Wait, then retry |
| **Token expired** | "Session expired. Enter your passphrase to continue." (auto-modal) | Re-authenticate |
| **No providers configured** | "No AI providers configured. Let's set one up." + [Settings] button | Add provider |
| **Provider timeout** | Toast: "DeepSeek didn't respond in time. Using fallback." | Auto-fallback |
| **Provider auth failed** | Toast: "Provider API key may be invalid. Check Settings." + [Settings] link | Update API key |
| **All providers offline** | "All providers are currently unavailable. Please try again." | Retry button |
| **Network error** | "Connection lost. Messages will be sent when you're back online." | Auto-retry on reconnect |
| **PII detection error** | "Couldn't scan for PII. Your message was sent as-is." (warning toast) | Message sent without PII protection |
| **Draft partial failure** | "2 of 3 providers responded. Showing available results." | Show successful drafts |
| **Session delete** | Confirm dialog: "Delete this conversation? This cannot be undone." | Confirm or cancel |
| **Account deletion** | "This will permanently delete all your data. Type DELETE to confirm." | Type DELETE to confirm |

### Toast component behavior

```
Position: bottom-right
Duration: 5 seconds (auto-dismiss), or persist for errors
Stack: max 3 toasts, oldest dismissed
Actions: "Dismiss" button on all toasts; action button for actionable errors
```

---

## 11. Component Architecture

### Component tree

```
App
├── Login
├── Layout
│   ├── Sidebar
│   │   ├── SessionList
│   │   ├── NewSessionButton
│   │   └── SidebarNav (Settings, Metrics, Agents)
│   ├── Chat
│   │   ├── Message (repeated)
│   │   │   ├── MessageContent
│   │   │   ├── MessageActions (copy, regenerate)
│   │   │   └── FeedbackButtons (thumbs up/down)
│   │   ├── MessageInput
│   │   │   ├── TextInput
│   │   │   ├── PIIIndicator
│   │   │   ├── CommandHints (/draft, /local, /compare)
│   │   │   └── SendButton
│   │   └── DraftPanel
│   │       └── DraftCard (repeated)
│   │           ├── DraftHeader (provider, model, latency)
│   │           ├── DraftContent
│   │           └── DraftActions (expand, pick winner)
│   ├── Settings (overlay)
│   │   ├── ProviderSetup
│   │   ├── PIISettings
│   │   ├── RoutingSettings
│   │   └── ThemeSettings
│   ├── Metrics (overlay)
│   └── Toast (floating)
```

### 12 Components

| # | Component | Responsibility | State |
|---|-----------|---------------|-------|
| 1 | **App** | Root component, auth state, theme | `isLoggedIn`, `theme` |
| 2 | **Login** | Passphrase input, auth flow | `passphrase`, `loading`, `error` |
| 3 | **Chat** | Message list, input, keyboard handling | `messages[]`, `isStreaming` |
| 4 | **Message** | Single message bubble, PII rehydration | `message`, `isStreaming` |
| 5 | **MessageInput** | Text input, PII indicator, command hints | `text`, `piiCount`, `commandPrefix` |
| 6 | **DraftPanel** | Draft round display, winner selection | `drafts[]`, `winnerId`, `isLoading` |
| 7 | **DraftCard** | Single draft result | `draft`, `isExpanded`, `isWinner` |
| 8 | **Sidebar** | Session list, navigation | `sessions[]`, `activeSessionId` |
| 9 | **Settings** | Right drawer, settings sections | `activeSection`, `preferences` |
| 10 | **ProviderSetup** | Add/edit/remove providers | `providers[]`, `formState` |
| 11 | **Metrics** | Usage stats, routing breakdown | `stats`, `period` |
| 12 | **Toast** | Floating notifications | `toasts[]` |

### State management (preact-signals)

```typescript
import { signal, computed, effect } from 'preact/signals';

// Global signals
const authState = signal({ isLoggedIn: false, userId: null });
const activeSessionId = signal<string | null>(null);
const sessions = signal<Session[]>([]);
const theme = signal<'dark' | 'light'>('dark');
const toasts = signal<Toast[]>([]);

// Derived (computed)
const activeSession = computed(() =>
  sessions.value.find(s => s.id === activeSessionId.value)
);

const sidebarOpen = signal(true);
const overlay = signal<'settings' | 'metrics' | 'draft' | null>(null);
```

---

## 12. Devil's Advocate

### "Preact + HTM with no build step limits UI complexity."

**Counterargument:** Tagged template literals are hard to read for complex components. No TypeScript support in templates (HTM is runtime). No hot module replacement for development.

**Rebuttal:** True for complex UIs, but log-origin's UI is intentionally simple — it's a chat interface, not a dashboard. The 12 components are all straightforward (input, message list, sidebar). For Phase 1, no-build is the right trade-off to keep deployment simple. If the UI grows complex, we can add a Vite build step (Preact + TSX) as an upgrade path — the components don't need to change.

### "28KB bundle target is unrealistic if we add features."

**Counterargument:** Preact is 4KB, but adding chart libraries (for metrics), icons, and CSS utilities will quickly exceed 28KB.

**Rebuttal:** The 28KB target is for Phase 1 (chat + settings + basic feedback). Metrics charts can be lazy-loaded (they're in an overlay, not the critical path). Icons can be inline SVGs (tiny). The total should stay under 50KB even with Phase 2 features. For Phase 3+ (metrics dashboard with real charts), we accept a larger bundle with code splitting.

### "Single-page overlay model is bad for deep linking."

**Counterargument:** Users can't bookmark a specific session or settings page. Browser back/forward doesn't work.

**Rebuttal:** For a personal tool, deep linking is low priority. However, we can add hash-based routing (`#/sessions/:id`, `#/settings`) without a router library — it's ~20 lines of code. The overlay model doesn't prevent routing; it just makes routing optional for Phase 1.

---

## 13. Open Questions

1. **Mobile layout:** How does the sidebar work on mobile? Bottom tab bar? Swipe-in drawer? We need a mobile-specific wireframe.

2. **File upload UX:** How do users upload photos/documents? Drag-and-drop? Paperclip button? How do we show upload progress?

3. **Session search:** Should users be able to search across all sessions? Full-text search over messages? This requires D1 FTS or an external index.

4. **Streaming rendering:** How do we render streaming responses smoothly without layout shifts? Should we use a virtualized list for long conversations?

5. **Provider icon/branding:** Should each provider have a visual indicator (logo, color)? How do we handle providers that don't have official branding?

6. **Accessibility of PII indicators:** How do screen readers announce PII tokens? Should there be a toggle to show/hide entity tokens in the UI?

7. **Offline support:** Should the UI work offline (read cached messages)? Service worker caching strategy?
