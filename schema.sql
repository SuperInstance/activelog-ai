-- ActiveLog.Ai D1 Schema
-- Run: wrangler d1 execute activelog --file=schema.sql

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  title TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds INTEGER,
  location_start TEXT,
  location_end TEXT,
  annotation_count INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  tags TEXT DEFAULT '[]',
  raw_markdown TEXT NOT NULL,
  audio_url TEXT,
  synced_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_sessions_tags ON sessions(tags);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  speed REAL,
  heading REAL,
  depth REAL,
  water_temp REAL,
  text_before TEXT,
  text_after TEXT,
  tags TEXT DEFAULT '[]',
  important INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ann_session ON annotations(session_id);
CREATE INDEX IF NOT EXISTS idx_ann_ts ON annotations(timestamp);
CREATE INDEX IF NOT EXISTS idx_ann_loc ON annotations(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_ann_tags ON annotations(tags);

CREATE TABLE IF NOT EXISTS vessel_data (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  timestamp TEXT NOT NULL,
  source TEXT NOT NULL,  -- 'sounder', 'nmea', 'camera', 'manual'
  data_type TEXT NOT NULL,
  value TEXT NOT NULL,   -- JSON blob
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vessel_ts ON vessel_data(timestamp);
CREATE INDEX IF NOT EXISTS idx_vessel_source ON vessel_data(source);
CREATE INDEX IF NOT EXISTS idx_vessel_session ON vessel_data(session_id);
