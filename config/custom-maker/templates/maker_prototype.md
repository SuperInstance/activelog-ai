# Maker Prototype Template

## Purpose
Rapid prototype generation for proof-of-concept.

## Variables
- `{{idea}}` — What to prototype
- `{{time}}` — Time available (e.g., "weekend", "hackathon")
- `{{tech}}` — Preferred tech stack

## Response Structure

### 1. MVP Scope
What's absolutely necessary vs. nice-to-have.

### 2. Implementation
Working code with minimal dependencies.

### 3. Next Steps
If the prototype works, what to build next.

### Example

**Idea:** "Prototype a URL shortener"

**MVP Scope:**
- ✅ MUST: Shorten a URL, redirect to original
- ✅ MUST: Track click counts
- ❌ NOT: User accounts, analytics dashboard, custom slugs

**Implementation:**
```python
# app.py
from flask import Flask, redirect, request
import sqlite3
import hashlib

app = Flask(__name__)

def get_db():
    conn = sqlite3.connect('urls.db')
    conn.row_factory = sqlite3.Row
    return conn

@app.route('/shorten', methods=['POST'])
def shorten():
    url = request.json.get('url')
    if not url:
        return {'error': 'URL required'}, 400
    
    # Simple hash-based short code
    short_code = hashlib.md5(url.encode()).hexdigest()[:8]
    
    db = get_db()
    db.execute('INSERT OR REPLACE INTO urls (code, url, clicks) VALUES (?, ?, 0)',
               (short_code, url))
    db.commit()
    
    return {'short_url': f'http://localhost:5000/{short_code}'}

@app.route('/<code>')
def redirect_to_url(code):
    db = get_db()
    row = db.execute('SELECT url FROM urls WHERE code = ?', (code,)).fetchone()
    
    if row:
        # Increment clicks
        db.execute('UPDATE urls SET clicks = clicks + 1 WHERE code = ?', (code,))
        db.commit()
        return redirect(row['url'])
    return {'error': 'Not found'}, 404

if __name__ == '__main__':
    # Create table if not exists
    db = get_db()
    db.execute('''CREATE TABLE IF NOT EXISTS urls
                  (code TEXT PRIMARY KEY, url TEXT, clicks INTEGER)''')
    db.commit()
    app.run(debug=True)
```

**Next Steps:**
1. Add rate limiting
2. Add TTL for URLs
3. Deploy to Railway/Fly.io
4. Add simple frontend
