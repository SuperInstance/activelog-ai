-- log-origin initial schema
-- Source: docs/database/SCHEMA-DESIGN.md

-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now')),
  description TEXT,
  PRIMARY KEY (version)
);

-- User preferences (key-value store)
CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, key)
);

-- Conversation sessions
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  summary TEXT,
  metadata TEXT DEFAULT '{}',
  message_count INTEGER NOT NULL DEFAULT 0,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, created_at DESC);

-- Chat messages
CREATE TABLE IF NOT EXISTS messages (
  id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  model TEXT,
  route TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id, created_at DESC);

-- PII entity map (real values are encrypted at rest)
CREATE TABLE IF NOT EXISTS pii_entities (
  entity_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  real_value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (entity_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_pii_user ON pii_entities(user_id, entity_type);

-- AI interactions (the LOG — every AI call with full metadata)
CREATE TABLE IF NOT EXISTS interactions (
  id TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL,
  user_input TEXT NOT NULL,
  rewritten_input TEXT,
  route_action TEXT NOT NULL CHECK(route_action IN ('cheap', 'escalation', 'compare', 'draft', 'local', 'manual')),
  route_reason TEXT,
  target_model TEXT NOT NULL,
  response TEXT NOT NULL,
  escalation_response TEXT,
  response_latency_ms INTEGER,
  escalation_latency_ms INTEGER,
  feedback TEXT CHECK(feedback IS NULL OR feedback IN ('up', 'down')),
  critique TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_interactions_user ON interactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_session ON interactions(session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_interactions_action ON interactions(route_action, feedback);

-- Routing rules (static + learned)
CREATE TABLE IF NOT EXISTS routing_rules (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '_system',
  name TEXT NOT NULL,
  pattern TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('cheap', 'escalation', 'compare', 'draft', 'local', 'manual')),
  confidence REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL CHECK(source IN ('static', 'learned', 'manual')) DEFAULT 'static',
  enabled INTEGER NOT NULL DEFAULT 1,
  hit_count INTEGER NOT NULL DEFAULT 0,
  correct_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_routing_user ON routing_rules(user_id, enabled);
CREATE INDEX IF NOT EXISTS idx_routing_source ON routing_rules(source, action);

-- Provider configurations (API keys encrypted at rest)
CREATE TABLE IF NOT EXISTS providers (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT '_system',
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  api_key_encrypted TEXT,
  temperature REAL NOT NULL DEFAULT 0.7,
  max_tokens INTEGER NOT NULL DEFAULT 4096,
  capabilities TEXT DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_providers_user ON providers(user_id, enabled);

-- Provider health tracking
CREATE TABLE IF NOT EXISTS provider_health (
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL DEFAULT '_system',
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  avg_latency_ms INTEGER,
  total_requests INTEGER NOT NULL DEFAULT 0,
  degradation_start TEXT,
  recovery_threshold INTEGER NOT NULL DEFAULT 3,
  status TEXT NOT NULL DEFAULT 'healthy' CHECK(status IN ('healthy', 'degraded', 'offline')),
  last_check_at TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider_id, user_id)
);

-- Agent registry
CREATE TABLE IF NOT EXISTS agent_registry (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  agent_type TEXT NOT NULL CHECK(agent_type IN ('local', 'cloud', 'hybrid')),
  endpoint TEXT,
  capabilities TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online', 'degraded', 'offline')),
  priority INTEGER NOT NULL DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_agents_user ON agent_registry(user_id, status);

-- Agent heartbeat history
CREATE TABLE IF NOT EXISTS agent_health (
  agent_id TEXT NOT NULL REFERENCES agent_registry(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('online', 'degraded', 'offline')),
  latency_ms INTEGER,
  metadata TEXT DEFAULT '{}',
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (agent_id, checked_at)
);

-- Training data exports
CREATE TABLE IF NOT EXISTS training_exports (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  format TEXT NOT NULL CHECK(format IN ('lora_jsonl', 'dpo_pairs', 'csv')),
  record_count INTEGER NOT NULL DEFAULT 0,
  quality_score_avg REAL,
  file_path TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_exports_user ON training_exports(user_id, created_at DESC);

-- Insert initial schema version
INSERT OR IGNORE INTO schema_version (version, description) VALUES (1, 'Initial schema');
