# Component Specification — log-origin

> Detailed component specifications for the 12 core UI components in log-origin.

## Table of Contents

1. [Component Overview](#1-component-overview)
2. [App Component](#2-app-component)
3. [Login Component](#3-login-component)
4. [Chat Component](#4-chat-component)
5. [Message Component](#5-message-component)
6. [MessageInput Component](#6-messageinput-component)
7. [DraftPanel Component](#7-draftpanel-component)
8. [DraftCard Component](#8-draftcard-component)
9. [Sidebar Component](#9-sidebar-component)
10. [Settings Component](#10-settings-component)
11. [ProviderSetup Component](#11-providersetup-component)
12. [Metrics Component](#12-metrics-component)
13. [Toast Component](#13-toast-component)
14. [Component Interactions](#14-component-interactions)
15. [State Management Details](#15-state-management-details)

---

## 1. Component Overview

### Component Hierarchy

```
App (root)
├── Login (conditional)
├── Layout (conditional)
│   ├── Sidebar
│   ├── Chat
│   │   ├── Message (multiple)
│   │   ├── MessageInput
│   │   └── DraftPanel (conditional)
│   ├── Settings (overlay)
│   ├── Metrics (overlay)
│   └── Toast (floating)
```

### Technology Stack

- **Framework:** Preact 10.26 (4KB)
- **State Management:** preact-signals (2KB)
- **Styling:** CSS custom properties (no framework)
- **Templating:** HTM (tagged template literals, 1KB)
- **Icons:** Inline SVG (no icon library)
- **Build:** None (static assets served by Worker)

---

## 2. App Component

### Purpose
Root component that manages authentication state, theme, and global layout.

### Props
None (root component)

### State
```typescript
interface AppState {
  isLoggedIn: boolean;
  userId: string | null;
  theme: 'dark' | 'light';
  isLoading: boolean;
  error: string | null;
}
```

### Signals
```typescript
// Global signals (shared across components)
const authState = signal({ isLoggedIn: false, userId: null });
const theme = signal<'dark' | 'light'>('dark');
const toasts = signal<Toast[]>([]);
const overlay = signal<'settings' | 'metrics' | 'draft' | null>(null);
```

### Template
```javascript
function App() {
  return html`
    <div class="app" data-theme=${theme.value}>
      ${authState.value.isLoggedIn
        ? html`<${Layout} />`
        : html`<${Login} />`
      }
      <${ToastContainer} />
    </div>
  `;
}
```

### CSS
```css
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--lo-bg-primary);
  color: var(--lo-text-primary);
  font-family: var(--lo-font-sans);
  font-size: var(--lo-font-size-base);
  line-height: 1.5;
  overflow: hidden;
}
```

---

## 3. Login Component

### Purpose
Handle passphrase authentication and initial setup.

### Props
None

### State
```typescript
interface LoginState {
  passphrase: string;
  isLoading: boolean;
  error: string | null;
  showRecoveryKey: boolean;
  recoveryKey: string | null;
}
```

### Events
- `onSubmit`: Send passphrase to `/api/auth`
- `onRecoveryKeyGenerated`: Display recovery key for user to save
- `onAutoLockChange`: Toggle "stay logged in" preference

### Template
```javascript
function Login() {
  const [passphrase, setPassphrase] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showRecoveryKey, setShowRecoveryKey] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Authentication failed');
      }
      
      const data = await response.json();
      authState.value = { isLoggedIn: true, userId: data.user_id };
      
      // Show recovery key if this is first login
      if (data.is_first_login) {
        const key = await generateRecoveryKey(passphrase);
        setRecoveryKey(key);
        setShowRecoveryKey(true);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return html`
    <div class="login">
      <div class="login-card">
        <div class="login-header">
          <h1>🔐 log-origin</h1>
          <p>Your AI remembers</p>
        </div>
        
        ${showRecoveryKey
          ? html`
              <div class="recovery-key">
                <h2>🔑 Save Your Recovery Key</h2>
                <p>If you lose your passphrase, this key is the ONLY way to recover your data.</p>
                <div class="key-display">${recoveryKey}</div>
                <div class="key-actions">
                  <button onclick=${() => navigator.clipboard.writeText(recoveryKey)}>
                    Copy to Clipboard
                  </button>
                  <button onclick=${() => setShowRecoveryKey(false)}>
                    I've Saved It
                  </button>
                </div>
              </div>
            `
          : html`
              <form class="login-form" onsubmit=${handleSubmit}>
                ${error && html`<div class="error">${error}</div>`}
                
                <label for="passphrase">Passphrase</label>
                <input
                  type="password"
                  id="passphrase"
                  value=${passphrase}
                  oninput=${(e) => setPassphrase(e.target.value)}
                  placeholder="Enter your passphrase"
                  autocomplete="current-password"
                  autofocus
                  required
                />
                
                <div class="login-options">
                  <label>
                    <input type="checkbox" checked />
                    Auto-lock after 15 minutes
                  </label>
                  <label>
                    <input type="checkbox" />
                    Stay logged in (not recommended)
                  </label>
                </div>
                
                <button type="submit" disabled=${isLoading}>
                  ${isLoading ? 'Unlocking...' : 'Unlock'}
                </button>
              </form>
            `
        }
      </div>
    </div>
  `;
}
```

### CSS
```css
.login {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  padding: var(--lo-space-lg);
}

.login-card {
  width: 100%;
  max-width: 400px;
  background: var(--lo-bg-secondary);
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  padding: var(--lo-space-xl);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.login-header {
  text-align: center;
  margin-bottom: var(--lo-space-xl);
}

.login-header h1 {
  margin: 0;
  font-size: 2rem;
  font-weight: 600;
}

.login-header p {
  margin: var(--lo-space-xs) 0 0;
  color: var(--lo-text-secondary);
  font-size: var(--lo-font-size-sm);
}

.login-form label {
  display: block;
  margin-bottom: var(--lo-space-xs);
  font-weight: 500;
  color: var(--lo-text-secondary);
}

.login-form input[type="password"] {
  width: 100%;
  padding: var(--lo-space-sm) var(--lo-space-md);
  background: var(--lo-bg-tertiary);
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  color: var(--lo-text-primary);
  font-size: var(--lo-font-size-base);
  margin-bottom: var(--lo-space-lg);
}

.login-form input[type="password"]:focus {
  outline: none;
  border-color: var(--lo-accent);
  box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2);
}

.login-options {
  margin-bottom: var(--lo-space-lg);
  font-size: var(--lo-font-size-sm);
}

.login-options label {
  display: flex;
  align-items: center;
  margin-bottom: var(--lo-space-sm);
  font-weight: normal;
}

.login-options input[type="checkbox"] {
  margin-right: var(--lo-space-sm);
}

.login-form button {
  width: 100%;
  padding: var(--lo-space-sm) var(--lo-space-md);
  background: var(--lo-accent);
  color: white;
  border: none;
  border-radius: var(--lo-border-radius);
  font-size: var(--lo-font-size-base);
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--lo-transition);
}

.login-form button:hover {
  background: var(--lo-accent-hover);
}

.login-form button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid var(--lo-error);
  color: var(--lo-error);
  padding: var(--lo-space-sm) var(--lo-space-md);
  border-radius: var(--lo-border-radius);
  margin-bottom: var(--lo-space-lg);
  font-size: var(--lo-font-size-sm);
}

.recovery-key {
  text-align: center;
}

.recovery-key h2 {
  margin: 0 0 var(--lo-space-sm);
  font-size: 1.25rem;
}

.recovery-key p {
  margin: 0 0 var(--lo-space-lg);
  color: var(--lo-text-secondary);
  font-size: var(--lo-font-size-sm);
  line-height: 1.6;
}

.key-display {
  background: var(--lo-bg-tertiary);
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  padding: var(--lo-space-md);
  margin-bottom: var(--lo-space-lg);
  font-family: var(--lo-font-mono);
  font-size: var(--lo-font-size-sm);
  word-break: break-all;
  user-select: all;
}

.key-actions {
  display: flex;
  gap: var(--lo-space-sm);
}

.key-actions button {
  flex: 1;
  padding: var(--lo-space-sm) var(--lo-space-md);
  background: var(--lo-bg-tertiary);
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  color: var(--lo-text-primary);
  font-size: var(--lo-font-size-base);
  cursor: pointer;
  transition: all var(--lo-transition);
}

.key-actions button:hover {
  background: var(--lo-bg-secondary);
  border-color: var(--lo-accent);
}
```

---

## 4. Chat Component

### Purpose
Main chat interface displaying messages and handling input.

### Props
```typescript
interface ChatProps {
  sessionId: string;
  sessionTitle: string;
}
```

### State
```typescript
interface ChatState {
  messages: Message[];
  isStreaming: boolean;
  draftRoundId: string | null;
  showDraftPanel: boolean;
}
```

### Signals
```typescript
const activeSessionId = signal<string | null>(null);
const sessions = signal<Session[]>([]);
const messages = signal<Message[]>([]);
```

### Template
```javascript
function Chat({ sessionId, sessionTitle }) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [showDraftPanel, setShowDraftPanel] = useState(false);
  const [draftRoundId, setDraftRoundId] = useState(null);
  
  const activeSession = computed(() =>
    sessions.value.find(s => s.id === activeSessionId.value)
  );
  
  const handleSendMessage = async (content, commandPrefix) => {
    if (commandPrefix === 'draft') {
      setShowDraftPanel(true);
      // Execute draft round
      const roundId = await executeDraftRound(content);
      setDraftRoundId(roundId);
    } else {
      // Normal message
      setIsStreaming(true);
      await sendMessage(content, commandPrefix);
      setIsStreaming(false);
    }
  };
  
  const handlePickWinner = async (providerId) => {
    await submitDraftWinner(draftRoundId, providerId);
    setShowDraftPanel(false);
    setDraftRoundId(null);
  };

  return html`
    <div class="chat">
      <div class="chat-header">
        <h2>${sessionTitle}</h2>
        <div class="chat-actions">
          <button onclick=${() => overlay.value = 'metrics'}>
            📊 Metrics
          </button>
        </div>
      </div>
      
      <div class="messages">
        ${messages.value.map(msg => html`
          <${Message} key=${msg.id} message=${msg} />
        `)}
        
        ${isStreaming && html`
          <div class="streaming-indicator">
            <div class="typing-dots">
              <span></span><span></span><span></span>
            </div>
          </div>
        `}
      </div>
      
      ${showDraftPanel
        ? html`
            <${DraftPanel}
              roundId=${draftRoundId}
              onPickWinner=${handlePickWinner}
              onClose=${() => setShowDraftPanel(false)}
            />
          `
        : html`
            <${MessageInput}
              onSend=${handleSendMessage}
              disabled=${isStreaming}
            />
          `
      }
    </div>
  `;
}
```

### CSS
```css
.chat {
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100vh;
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--lo-space-md) var(--lo-space-lg);
  border-bottom: 1px solid var(--lo-border);
  background: var(--lo-bg-secondary);
  flex-shrink: 0;
}

.chat-header h2 {
  margin: 0;
  font-size: var(--lo-font-size-lg);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chat-actions button {
  background: none;
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  color: var(--lo-text-secondary);
  padding: var(--lo-space-xs) var(--lo-space-sm);
  font-size: var(--lo-font-size-sm);
  cursor: pointer;
  transition: all var(--lo-transition);
}

.chat-actions button:hover {
  border-color: var(--lo-accent);
  color: var(--lo-text-primary);
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--lo-space-lg);
  display: flex;
  flex-direction: column;
  gap: var(--lo-space-lg);
}

.streaming-indicator {
  display: flex;
  align-items: center;
  padding: var(--lo-space-md);
  background: var(--lo-bg-secondary);
  border-radius: var(--lo-border-radius);
  margin-top: var(--lo-space-md);
}

.typing-dots {
  display: flex;
  gap: 4px;
}

.typing-dots span {
  width: 8px;
  height: 8px;
  background: var(--lo-text-secondary);
  border-radius: 50%;
  animation: typing 1.4s infinite;
}

.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-4px); }
}
```

### CSS for Message Component
```css
.message {
  background: var(--lo-bg-secondary);
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  padding: var(--lo-space-md);
  max-width: 85%;
  align-self: flex-start;
}

.message.user {
  align-self: flex-end;
  background: var(--lo-accent);
  color: white;
  border-color: var(--lo-accent);
}

.message.assistant {
  align-self: flex-start;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--lo-space-sm);
  font-size: var(--lo-font-size-sm);
}

.message-role {
  display: flex;
  align-items: center;
  gap: var(--lo-space-sm);
  font-weight: 500;
}

.model, .latency {
  background: var(--lo-bg-tertiary);
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 0.75rem;
  font-weight: normal;
}

.message.user .model,
.message.user .latency {
  background: rgba(255, 255, 255, 0.2);
}

.message-time {
  color: var(--lo-text-muted);
  font-size: 0.75rem;
}

.message-content {
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.message:not(.expanded) .message-content {
  max-height: 300px;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, black 80%, transparent 100%);
}

.message-actions {
  display: flex;
  gap: var(--lo-space-sm);
  margin-top: var(--lo-space-md);
}

.message-actions button {
  background: none;
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  color: var(--lo-text-secondary);
  padding: 4px 8px;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--lo-transition);
}

.message-actions button:hover {
  border-color: var(--lo-accent);
  color: var(--lo-text-primary);
}

.feedback-buttons {
  display: flex;
  gap: var(--lo-space-sm);
  margin-top: var(--lo-space-md);
}

.feedback-buttons button {
  flex: 1;
  padding: var(--lo-space-sm);
  border: none;
  border-radius: var(--lo-border-radius);
  font-size: var(--lo-font-size-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--lo-transition);
}

.feedback-up {
  background: var(--lo-success);
  color: white;
}

.feedback-down {
  background: var(--lo-error);
  color: white;
}

.feedback-submitted {
  margin-top: var(--lo-space-md);
  padding: var(--lo-space-sm);
  background: rgba(63, 185, 80, 0.1);
  border: 1px solid var(--lo-success);
  border-radius: var(--lo-border-radius);
  color: var(--lo-success);
  font-size: var(--lo-font-size-sm);
  text-align: center;
}

.message-meta {
  display: flex;
  gap: var(--lo-space-sm);
  margin-top: var(--lo-space-md);
  font-size: var(--lo-font-size-sm);
}

.route-badge {
  background: var(--lo-bg-tertiary);
  border: 1px solid var(--lo-border);
  border-radius: 12px;
  padding: 2px 8px;
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.5px;
}

.confidence {
  background: var(--lo-accent);
  color: white;
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 0.7rem;
}
```

---

## 6. MessageInput Component

### Purpose
Text input for sending messages with PII detection and command hints.

### Props
```typescript
interface MessageInputProps {
  onSend: (content: string, commandPrefix?: string) => Promise<void>;
  disabled?: boolean;
}
```

### State
```typescript
interface MessageInputState {
  text: string;
  piiCount: number;
  commandPrefix: string | null;
  isDetectingPII: boolean;
}
```

### Template
```javascript
function MessageInput({ onSend, disabled = false }) {
  const [text, setText] = useState('');
  const [piiCount, setPiiCount] = useState(0);
  const [commandPrefix, setCommandPrefix] = useState(null);
  const [isDetectingPII, setIsDetectingPII] = useState(false);
  
  const COMMAND_PREFIXES = ['/draft', '/local', '/compare', '/manual'];
  
  const detectPII = async (text) => {
    setIsDetectingPII(true);
    // Client-side PII detection
    const entities = await detectEntities(text);
    setPiiCount(entities.length);
    setIsDetectingPII(false);
  };
  
  const handleInput = (e) => {
    const newText = e.target.value;
    setText(newText);
    
    // Check for command prefixes
    const trimmed = newText.trim();
    const prefix = COMMAND_PREFIXES.find(p => trimmed.startsWith(p + ' '));
    setCommandPrefix(prefix || null);
    
    // Debounced PII detection
    clearTimeout(detectTimeout);
    detectTimeout = setTimeout(() => detectPII(newText), 300);
  };
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim() || disabled) return;
    
    const content = commandPrefix 
      ? text.trim().substring(commandPrefix.length + 1)
      : text.trim();
    
    await onSend(content, commandPrefix);
    setText('');
    setPiiCount(0);
    setCommandPrefix(null);
  };
  
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return html`
    <div class="message-input">
      <form onsubmit=${handleSubmit}>
        <div class="input-wrapper">
          <textarea
            value=${text}
            oninput=${handleInput}
            onkeydown=${handleKeyDown}
            placeholder="Type a message..."
            rows="1"
            disabled=${disabled}
            autofocus
          />
          
          <div class="input-actions">
            ${piiCount > 0 && html`
              <div class="pii-indicator" title="${piiCount} PII entities detected">
                🔒 ${piiCount}
              </div>
            `}
            
            ${isDetectingPII && html`
              <div class="pii-detecting">
                Scanning...
              </div>
            `}
            
            <button type="submit" disabled=${!text.trim() || disabled}>
              ${disabled ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
        
        ${commandPrefix && html`
          <div class="command-hint">
            Using ${commandPrefix} mode
          </div>
        `}
        
        <div class="command-hints">
          ${COMMAND_PREFIXES.map(prefix => html`
            <button
              class=${commandPrefix === prefix ? 'active' : ''}
              onclick=${() => {
                if (text.trim().startsWith(prefix + ' ')) {
                  setText(text.trim().substring(prefix.length + 1));
                  setCommandPrefix(null);
                } else {
                  setText(`${prefix} ${text}`);
                  setCommandPrefix(prefix);
                }
              }}
            >
              ${prefix}
            </button>
          `)}
        </div>
      </form>
    </div>
  `;
}
```

### CSS
```css
.message-input {
  padding: var(--lo-space-md) var(--lo-space-lg);
  border-top: 1px solid var(--lo-border);
  background: var(--lo-bg-secondary);
  flex-shrink: 0;
}

.input-wrapper {
  display: flex;
  gap: var(--lo-space-sm);
  align-items: flex-end;
}

.message-input textarea {
  flex: 1;
  min-height: 44px;
  max-height: 200px;
  padding: var(--lo-space-sm) var(--lo-space-md);
  background: var(--lo-bg-tertiary);
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  color: var(--lo-text-primary);
  font-family: var(--lo-font-sans);
  font-size: var(--lo-font-size-base);
  line-height: 1.5;
  resize: none;
  overflow-y: auto;
}

.message-input textarea:focus {
  outline: none;
  border-color: var(--lo-accent);
  box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2);
}

.message-input textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-actions {
  display: flex;
  gap: var(--lo-space-sm);
  align-items: center;
}

.pii-indicator {
  background: var(--lo-success);
  color: white;
  border-radius: 12px;
  padding: 4px 8px;
  font-size: 0.75rem;
  font-weight: 500;
}

.pii-detecting {
  color: var(--lo-text-muted);
  font-size: 0.75rem;
  animation: pulse 1.5s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}

.message-input button[type="submit"] {
  height: 44px;
  padding: 0 var(--lo-space-lg);
  background: var(--lo-accent);
  color: white;
  border: none;
  border-radius: var(--lo-border-radius);
  font-size: var(--lo-font-size-base);
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--lo-transition);
}

.message-input button[type="submit"]:hover:not(:disabled) {
  background: var(--lo-accent-hover);
}

.message-input button[type="submit"]:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.command-hint {
  margin-top: var(--lo-space-sm);
  padding: var(--lo-space-xs) var(--lo-space-sm);
  background: rgba(88, 166, 255, 0.1);
  border: 1px solid var(--lo-accent);
  border-radius: var(--lo-border-radius);
  color: var(--lo-accent);
  font-size: var(--lo-font-size-sm);
  text-align: center;
}

.command-hints {
  display: flex;
  gap: var(--lo-space-xs);
  margin-top: var(--lo-space-sm);
  flex-wrap: wrap;
}

.command-hints button {
  background: var(--lo-bg-tertiary);
  border: 1px solid var(--lo-border);
  border-radius: 16px;
  padding: 4px 12px;
  color: var(--lo-text-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--lo-transition);
}

.command-hints button:hover {
  border-color: var(--lo-accent);
  color: var(--lo-text-primary);
}

.command-hints button.active {
  background: var(--lo-accent);
  border-color: var(--lo-accent);
  color: white;
}
```

---

## 7. DraftPanel Component

### Purpose
Display draft round results and handle winner selection.

### Props
```typescript
interface DraftPanelProps {
  roundId: string;
  onPickWinner: (providerId: string) => Promise<void>;
  onClose: () => void;
}
```

### State
```typescript
interface DraftPanelState {
  drafts: DraftResult[];
  isLoading: boolean;
  selectedWinner: string | null;
}
```

### Template
```javascript
function DraftPanel({ roundId, onPickWinner, onClose }) {
  const [drafts, setDrafts] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWinner, setSelectedWinner] = useState(null);
  
  useEffect(() => {
    loadDraftRound();
  }, [roundId]);
  
  const loadDraftRound = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/draft/${roundId}`);
      const data = await response.json();
      setDrafts(data.drafts);
    } catch (error) {
      toasts.value = [...toasts.value, {
        id: Date.now().toString(),
        type: 'error',
        message: 'Failed to load draft round',
        duration: 5000,
      }];
    } finally {
      setIsLoading(false);
    }
  };
  
  const handlePickWinner = async () => {
    if (!selectedWinner) return;
    
    setIsLoading(true);
    try {
      await onPickWinner(selectedWinner);
      onClose();
    } catch (error) {
      toasts.value = [...toasts.value, {
        id: Date.now().toString(),
        type: 'error',
        message: 'Failed to submit winner',
        duration: 5000,
      }];
    } finally {
      setIsLoading(false);
    }
  };

  return html`
    <div class="draft-panel">
      <div class="draft-header">
        <h3>Draft Round · ${drafts.length} providers</h3>
        <button onclick=${onClose} class="close-button">×</button>
      </div>
      
      ${isLoading && drafts.length === 0
        ? html`
            <div class="draft-loading">
              <div class="loading-spinner"></div>
              <p>Running draft round...</p>
            </div>
          `
        : html`
            <div class="draft-grid">
              ${drafts.map((draft, index) => html`
                <${DraftCard}
                  key=${draft.provider_id}
                  draft=${draft}
                  index=${index}
                  isSelected=${selectedWinner === draft.provider_id}
                  onSelect=${() => setSelectedWinner(draft.provider_id)}
                />
              `)}
            </div>
            
            <div class="draft-actions">
              <button onclick=${onClose}>
                ← Back to Chat
              </button>
              <button
                onclick=${handlePickWinner}
                disabled=${!selectedWinner || isLoading}
                class="pick-winner"
              >
                ${isLoading ? 'Submitting...' : 'Pick Winner'}
              </button>
            </div>
          `
      }
    </div>
  `;
}
```

### CSS
```css
.draft-panel {
  background: var(--lo-bg-secondary);
  border-top: 1px solid var(--lo-border);
  padding: var(--lo-space-lg);
  flex-shrink: 0;
}

.draft-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--lo-space-lg);
}

.draft-header h3 {
  margin: 0;
  font-size: var(--lo-font-size-lg);
  font-weight: 600;
}

.close-button {
  background: none;
  border: none;
  color: var(--lo-text-secondary);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.close-button:hover {
  background: var(--lo-bg-tertiary);
  color: var(--lo-text-primary);
}

.draft-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--lo-space-xl);
  color: var(--lo-text-secondary);
}

.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid var(--lo-border);
  border-top-color: var(--lo-accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: var(--lo-space-md);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.draft-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--lo-space-md);
  margin-bottom: var(--lo-space-lg);
}

.draft-actions {
  display: flex;
  justify-content: space-between;
  gap: var(--lo-space-md);
}

.draft-actions button {
  flex: 1;
  padding: var(--lo-space-sm) var(--lo-space-md);
  background: var(--lo-bg-tertiary);
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  color: var(--lo-text-primary);
  font-size: var(--lo-font-size-base);
  cursor: pointer;
  transition: all var(--lo-transition);
}

.draft-actions button:hover:not(:disabled) {
  border-color: var(--lo-accent);
}

.draft-actions .pick-winner {
  background: var(--lo-accent);
  border-color: var(--lo-accent);
  color: white;
  font-weight: 500;
}

.draft-actions .pick-winner:hover:not(:disabled) {
  background: var(--lo-accent-hover);
}
```

---

## 8. DraftCard Component

### Purpose
Display a single draft result with expandable content.

### Props
```typescript
interface DraftCardProps {
  draft: {
    provider_id: string;
    provider_name: string;
    model: string;
    content: string;
    latency_ms: number;
    tokens: { prompt: number; completion: number };
    error?: string;
  };
  index: number;
  isSelected: boolean;
  onSelect: () => void;
}
```

### State
```typescript
interface DraftCardState {
  isExpanded: boolean;
}
```

### Template
```javascript
function DraftCard({ draft, index, isSelected, onSelect }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const hasError = !!draft.error;
  const tokenCount = draft.tokens.prompt + draft.tokens.completion;
  
  return html`
    <div class="draft-card ${isSelected ? 'selected' : ''} ${hasError ? 'error' : ''}">
      <div class="draft-card-header" onclick=${onSelect}>
        <div class="draft-provider">
          <div class="draft-number">${index + 1}</div>
          <div>
            <div class="draft-name">${draft.provider_name}</div>
            <div class="draft-model">${draft.model}</div>
          </div>
        </div>
        
        <div class="draft-stats">
          <div class="draft-latency">${draft.latency_ms}ms</div>
          <div class="draft-tokens">${tokenCount} tokens</div>
        </div>
      </div>
      
      <div class="draft-card-content">
        ${hasError
          ? html`
              <div class="draft-error">
                <strong>Error:</strong> ${draft.error}
              </div>
            `
          : html`
              <div class="draft-preview">
                ${isExpanded
                  ? draft.content
                  : draft.content.substring(0, 200) + (draft.content.length > 200 ? '...' : '')
                }
              </div>
              
              ${draft.content.length > 200 && html`
                <button
                  class="expand-button"
                  onclick=${(e) => {
                    e.stopPropagation();
                    setIsExpanded(!isExpanded);
                  }}
                >
                  ${isExpanded ? 'Show less' : 'Show more'}
                </button>
              `}
            `
        }
      </div>
      
      <div class="draft-card-actions">
        <button
          class="select-button"
          onclick=${onSelect}
          disabled=${hasError}
        >
          ${isSelected ? '✓ Selected' : 'Select'}
        </button>
        
        ${!hasError && html`
          <button
            class="copy-button"
            onclick=${(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(draft.content);
              toasts.value = [...toasts.value, {
                id: Date.now().toString(),
                type: 'success',
                message: 'Copied to clipboard',
                duration: 2000,
              }];
            }}
          >
            📋 Copy
          </button>
        `}
      </div>
    </div>
  `;
}
```

### CSS
```css
.draft-card {
  background: var(--lo-bg-tertiary);
  border: 2px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  padding: var(--lo-space-md);
  transition: all var(--lo-transition);
  cursor: pointer;
}

.draft-card:hover {
  border-color: var(--lo-accent);
}

.draft-card.selected {
  border-color: var(--lo-accent);
  background: rgba(88, 166, 255, 0.05);
}

.draft-card.error {
  border-color: var(--lo-error);
  background: rgba(248, 81, 73, 0.05);
}

.draft-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--lo-space-md);
}

.draft-provider {
  display: flex;
  gap: var(--lo-space-sm);
  align-items: center;
}

.draft-number {
  width: 24px;
  height: 24px;
  background: var(--lo-accent);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  font-weight: 600;
}

.draft-card.error .draft-number {
  background: var(--lo-error);
}

.draft-name {
  font-weight: 600;
  margin-bottom: 2px;
}

.draft-model {
  font-size: 0.75rem;
  color: var(--lo-text-secondary);
}

.draft-stats {
  text-align: right;
  font-size: 0.75rem;
}

.draft-latency {
  color: var(--lo-text-primary);
  margin-bottom: 2px;
}

.draft-tokens {
  color: var(--lo-text-secondary);
}

.draft-card-content {
  margin-bottom: var(--lo-space-md);
}

.draft-error {
  background: rgba(248, 81, 73, 0.1);
  border: 1px solid var(--lo-error);
  border-radius: var(--lo-border-radius);
  padding: var(--lo-space-sm);
  color: var(--lo-error);
  font-size: var(--lo-font-size-sm);
}

.draft-preview {
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.expand-button {
  background: none;
  border: none;
  color: var(--lo-accent);
  font-size: var(--lo-font-size-sm);
  cursor: pointer;
  padding: 0;
  margin-top: var(--lo-space-xs);
}

.expand-button:hover {
  text-decoration: underline;
}

.draft-card-actions {
  display: flex;
  gap: var(--lo-space-sm);
}

.select-button, .copy-button {
  flex: 1;
  padding: var(--lo-space-xs) var(--lo-space-sm);
  border-radius: var(--lo-border-radius);
  font-size: var(--lo-font-size-sm);
  cursor: pointer;
  transition: all var(--lo-transition);
}

.select-button {
  background: var(--lo-accent);
  border: 1px solid var(--lo-accent);
  color: white;
  font-weight: 500;
}

.select-button:hover:not(:disabled) {
  background: var(--lo-accent-hover);
}

.select-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.copy-button {
  background: var(--lo-bg-secondary);
  border: 1px solid var(--lo-border);
  color: var(--lo-text-primary);
}

.copy-button:hover {
  border-color: var(--lo-accent);
}
```

---

## 9. Sidebar Component

### Purpose
Display session list, navigation, and agent status.

### Props
None

### State
```typescript
interface SidebarState {
  isCollapsed: boolean;
  searchQuery: string;
  showNewSessionForm: boolean;
}
```

### Template
```javascript
function Sidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewSessionForm, setShowNewSessionForm] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  
  const filteredSessions = computed(() =>
    sessions.value.filter(session =>
      session.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
  );
  
  const handleNewSession = async (e) => {
    e.preventDefault();
    if (!newSessionTitle.trim()) return;
    
    const response = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newSessionTitle }),
    });
    
    const session = await response.json();
    sessions.value = [...sessions.value, session];
    activeSessionId.value = session.id;
    
    setNewSessionTitle('');
    setShowNewSessionForm(false);
  };

  return html`
    <div class="sidebar ${isCollapsed ? 'collapsed' : ''}">
      <div class="sidebar-header">
        ${!isCollapsed && html`
          <h2>Sessions</h2>
        `}
        <button
          class="collapse-button"
          onclick=${() => setIsCollapsed(!isCollapsed)}
          title=${isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          ${isCollapsed ? '→' : '←'}
        </button>
      </div>
      
      ${!isCollapsed && html`
        <div class="sidebar-search">
          <input
            type="text"
            placeholder="Search sessions..."
            value=${searchQuery}
            oninput=${(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div class="sessions-list">
          ${filteredSessions.value.map(session => html`
            <div
              class="session-item ${activeSessionId.value === session.id ? 'active' : ''}"
              onclick=${() => activeSessionId.value = session.id}
            >
              <div class="session-title">${session.title || 'Untitled'}</div>
              <div class="session-meta">
                <span class="message-count">${session.message_count}</span>
                <span class="session-time">${formatRelativeTime(session.last_message_at)}</span>
              </div>
            </div>
          `)}
        </div>
        
        ${showNewSessionForm
          ? html`
              <form class="new-session-form" onsubmit=${handleNewSession}>
                <input
                  type="text"
                  placeholder="Session title..."
                  value=${newSessionTitle}
                  oninput=${(e) => setNewSessionTitle(e.target.value)}
                  autofocus
                />
                <div class="new-session-actions">
                  <button type="submit">Create</button>
                  <button type="button" onclick=${() => setShowNewSessionForm(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            `
          : html`
              <button
                class="new-session-button"
                onclick=${() => setShowNewSessionForm(true)}
              >
                + New Session
              </button>
            `
        }
        
        <div class="sidebar-nav">
          <button
            class=${overlay.value === 'settings' ? 'active' : ''}
            onclick=${() => overlay.value = overlay.value === 'settings' ? null : 'settings'}
          >
            ⚙ Settings
          </button>
          <button
            class=${overlay.value === 'metrics' ? 'active' : ''}
            onclick=${() => overlay.value = overlay.value === 'metrics' ? null : 'metrics'}
          >
            📊 Metrics
          </button>
          <button onclick=${() => overlay.value = 'agents'}>
            🤖 Agents
          </button>
        </div>
      `}
    </div>
  `;
}
```

### CSS
```css
.sidebar {
  width: var(--lo-sidebar-width);
  background: var(--lo-bg-secondary);
  border-right: 1px solid var(--lo-border);
  display: flex;
  flex-direction: column;
  transition: width var(--lo-transition);
  flex-shrink: 0;
}

.sidebar.collapsed {
  width: 60px;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--lo-space-md) var(--lo-space-lg);
  border-bottom: 1px solid var(--lo-border);
}

.sidebar-header h2 {
  margin: 0;
  font-size: var(--lo-font-size-lg);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapse-button {
  background: none;
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  color: var(--lo-text-secondary);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--lo-transition);
}

.collapse-button:hover {
  border-color: var(--lo-accent);
  color: var(--lo-text-primary);
}

.sidebar-search {
  padding: var(--lo-space-md) var(--lo-space-lg);
  border-bottom: 1px solid var(--lo-border);
}

.sidebar-search input {
  width: 100%;
  padding: var(--lo-space-sm) var(--lo-space-md);
  background: var(--lo-bg-tertiary);
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  color: var(--lo-text-primary);
  font-size: var(--lo-font-size-base);
}

.sidebar-search input:focus {
  outline: none;
  border-color: var(--lo-accent);
}

.sessions-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--lo-space-sm) 0;
}

.session-item {
  padding: var(--lo-space-sm) var(--lo-space-lg);
  cursor: pointer;
  transition: background-color var(--lo-transition);
}

.session-item:hover {
  background: var(--lo-bg-tertiary);
}

.session-item.active {
  background: var(--lo-accent);
  color: white;
}

.session-title {
  font-weight: 500;
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  opacity: 0.7;
}

.message-count {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 1px 6px;
}

.new-session-button {
  width: 100%;
  padding: var(--lo-space-sm) var(--lo-space-lg);
  background: var(--lo-bg-tertiary);
  border: none;
  border-top: 1px solid var(--lo-border);
  color: var(--lo-text-primary);
  font-size: var(--lo-font-size-base);
  cursor: pointer;
  transition: background-color var(--lo-transition);
}

.new-session-button:hover {
  background: var(--lo-bg-secondary);
}

.new-session-form {
  padding: var(--lo-space-md) var(--lo-space-lg);
  border-top: 1px solid var(--lo-border);
}

.new-session-form input {
  width: 100%;
  padding: var(--lo-space-sm) var(--lo-space-md);
  background: var(--lo-bg-tertiary);
  border: 1px solid var(--lo-border);
  border-radius: var(--lo-border-radius);
  color: var(--lo-text-primary);
  font-size: var(--lo-font-size-base);
  margin-bottom: var(--lo-space-sm);
}

.new-session-actions {
  display: flex;
  gap: var(--lo-space-sm);
}

.new-session-actions button {
  flex: 1;
  padding: var(--lo-space-xs) var(--lo-space-sm);
  border-radius: var(--lo-border-radius);
  font-size: var(--lo-font-size-sm);
  cursor: pointer;
  transition: all var(--lo-transition);
}

.new-session-actions button[type="submit"] {
  background: var(--lo-accent);
  border: 1px solid var(--lo-accent);
  color: white;
}

.new-session-actions button[type="button"] {
  background: var(--lo-bg-tertiary);
  border: 1px solid var(--lo-border);
  color: var(--lo-text-primary);
}

.sidebar-nav {
  border-top: 1px solid var(--lo-border);
  padding: var(--lo-space-sm) 0;
}

.sidebar-nav button {
  width: 100%;
  padding: var(--lo-space-sm) var(--lo-space-lg);
  background: none;
  border: none;
  color: var(--lo-text-secondary);
  font-size: var(--lo-font-size-base);
  text-align: left;
  cursor: pointer;
  transition: all var(--lo-transition);
}

.sidebar-nav button:hover {
  background: var(--lo-bg-tertiary);
  color: var(--lo-text-primary);
}

.sidebar-nav button.active {
  background: var(--lo-accent);
  color: white;
}
```

---

## 10. Settings Component

### Purpose
Right drawer overlay for user preferences and configuration.

### Props
None

### State
```typescript
interface SettingsState {
  activeTab: 'profile' | 'providers' | 'pii' | 'routing' | 'theme' | 'export';
  preferences: Record<string, any>;
  isSaving: boolean;
}
```

### Template
```javascript
function Settings() {
  const [activeTab, setActiveTab] = useState('profile');
  const [preferences, setPreferences] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  
  const tabs = [
    { id: 'profile', label: 'Profile', icon: '👤' },
    { id: 'providers', label: 'Providers', icon: '🤖' },
    { id: 'pii', label: 'PII', icon: '🔒' },
    { id: 'routing', label: 'Routing', icon: '🔄' },
    { id: 'theme


```

---

## 5. Message Component

### Purpose
Display a single message with role-specific styling and actions.

### Props
```typescript
interface MessageProps {
  message: {
    id: string;
    role: 'system' | 'user' | 'assistant';
    content: string;
    model?: string;
    provider?: string;
    latencyMs?: number;
    tokens?: { prompt: number; completion: number };
    createdAt: string;
    _meta?: {
      route?: { action: string; confidence: number };
      pii?: { detected: number; tokens: string[] };
      interactionId?: string;
    };
  };
}
```

### State
```typescript
interface MessageState {
  isExpanded: boolean;
  showFeedback: boolean;
  feedbackSubmitted: boolean;
}
```

### Template
```javascript
function Message({ message }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  
  const isAssistant = message.role === 'assistant';
  const hasFeedback = message._meta?.interactionId;
  
  const handleFeedback = async (rating) => {
    if (!hasFeedback) return;
    
    await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        interaction_id: message._meta.interactionId,
        rating,
      }),
    });
    
    setFeedbackSubmitted(true);
    setShowFeedback(false);
    
    // Show toast
    toasts.value = [...toasts.value, {
      id: Date.now().toString(),
      type: 'success',
      message: 'Feedback recorded',
      duration: 3000,
    }];
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return html`
    <div class="message ${message.role} ${isExpanded ? 'expanded' : ''}">
      <div class="message-header">
        <div class="message-role">
          ${message.role === 'user' ? '👤 You' : '🤖 Assistant'}
          ${message.model && html`<span class="model">${message.model}</span>`}
          ${message.latencyMs && html`<span class="latency">${message.latencyMs}ms</span>`}
        </div>
        <div class="message-time">${formatTime(message.createdAt)}</div>
      </div>
      
      <div class="message-content">
        ${message.content}
      </div>
      
      <div class="message-actions">
        <button onclick=${() => navigator.clipboard.writeText(message.content)}>
          📋 Copy
        </button>
        
        ${isAssistant && hasFeedback && !feedbackSubmitted && html`
          <button onclick=${() => setShowFeedback(!showFeedback)}>
            ${showFeedback ? 'Cancel' : '👍👎 Feedback'}
          </button>
        `}
        
        ${message.content.length > 500 && html`
          <button onclick=${() => setIsExpanded(!isExpanded)}>
            ${isExpanded ? 'Show less' : 'Show more'}
          </button>
        `}
      </div>
      
      ${showFeedback && html`
        <div class="feedback-buttons">
          <button onclick=${() => handleFeedback('up')} class="feedback-up">
            👍 Helpful
          </button>
          <button onclick=${() => handleFeedback('down')} class="feedback-down">
            👎 Not helpful
          </button>
        </div>
      `}
      
      ${feedbackSubmitted && html`
        <div class="feedback-submitted">
          ✓ Feedback submitted
        </div>
      `}
      
      ${message._meta?.route && html`
        <div class="message-meta">
          <span class="route-badge">${message._meta.route.action}</span>
          ${message._meta.route.confidence && html`
            <span class="confidence">${Math.round(message._meta.route.confidence * 100)}%</span>
          `}
        </div>
      `}
    </div>
  `;
}