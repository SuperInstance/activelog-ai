# Maker Debug Template

## Purpose
Systematic debugging with root cause analysis.

## Variables
- `{{error}}` — Error message or description
- `{{environment}}` — Runtime environment
- `{{recent_changes}}` — What changed recently

## Response Structure

### 1. Quick Diagnosis
1-2 sentence assessment of the most likely cause.

### 2. Root Cause Analysis
Step-by-step breakdown of WHY this error occurs, not just what it says.

### 3. Fix
Minimal, targeted fix for the root cause.

### 4. Verification
How to verify the fix works and prevent regression.

### Example

**Error:** "TypeError: Cannot read properties of undefined (reading 'map')"

**Quick Diagnosis:** You're calling `.map()` on something that's `undefined` — likely an API response that didn't return the expected shape.

**Root Cause:**
```javascript
// ❌ This assumes `users` is always an array
const UserList = ({ users }) => (
  <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
);

// If the API returns { data: null } or { users: undefined },
// you get the exact error above.
```

**Fix:**
```javascript
// ✅ Defensive with fallback
const UserList = ({ users = [] }) => (
  <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>
);

// ✅ Or with explicit handling for loading/error states
const UserList = ({ users, isLoading, error }) => {
  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;
  if (!users?.length) return <EmptyState />;
  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
};
```

**Verification:**
1. Test with empty array → renders empty state
2. Test with `undefined` → renders empty state (not crash)
3. Test with valid data → renders list
4. Add unit test for the undefined case

### Debugging Checklist
When debugging, always verify:
- [ ] Is the error from YOUR code or a dependency?
- [ ] Does it reproduce consistently or is it timing-related?
- [ ] What's the actual type of the value (not what you expect)?
- [ ] Is there a silent failure upstream that produces `undefined`?
- [ ] Does the fix handle ALL cases or just the one you hit?
