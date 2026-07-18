/**
 * Drizzle ORM schema for log-origin.
 * Source: docs/database/SCHEMA-DESIGN.md
 *
 * Note: Drizzle with D1 uses sqliteTable. Columns use text() instead of varchar/text
 * since D1 is SQLite. Integer booleans use integer() with .default(1).
 */

import { sqliteTable, text, integer, real, primaryKey, index } from 'drizzle-orm/sqlite-core';

// ─── Schema Version ───────────────────────────────────────────

export const schemaVersion = sqliteTable('schema_version', {
  version: integer('version').primaryKey(),
  appliedAt: text('applied_at').notNull().default(sql`datetime('now')`),
  description: text('description'),
});

// ─── User Preferences ─────────────────────────────────────────

export const userPreferences = sqliteTable('user_preferences', {
  userId: text('user_id').notNull(),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(sql`datetime('now')`),
}, (table) => [
  primaryKey({ columns: [table.userId, table.key] }),
]);

// ─── Sessions ─────────────────────────────────────────────────

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  summary: text('summary'),
  metadata: text('metadata').default('{}'),
  messageCount: integer('message_count').notNull().default(0),
  lastMessageAt: text('last_message_at'),
  createdAt: text('created_at').notNull().default(sql`datetime('now')`),
}, (table) => [
  index('idx_sessions_user').on(table.userId, table.createdAt),
]);

// ─── Messages ─────────────────────────────────────────────────

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  model: text('model'),
  route: text('route'),
  metadata: text('metadata').default('{}'),
  createdAt: text('created_at').notNull().default(sql`datetime('now')`),
}, (table) => [
  index('idx_messages_session').on(table.sessionId, table.createdAt),
  index('idx_messages_user').on(table.userId, table.createdAt),
]);

// ─── PII Entities ─────────────────────────────────────────────

export const piiEntities = sqliteTable('pii_entities', {
  entityId: text('entity_id').notNull(),
  userId: text('user_id').notNull(),
  entityType: text('entity_type').notNull(),
  realValue: text('real_value').notNull(),
  createdAt: text('created_at').notNull().default(sql`datetime('now')`),
  lastUsedAt: text('last_used_at').notNull().default(sql`datetime('now')`),
}, (table) => [
  primaryKey({ columns: [table.entityId, table.userId] }),
  index('idx_pii_user').on(table.userId, table.entityType),
]);

// ─── Interactions (The LOG) ──────────────────────────────────

export const interactions = sqliteTable('interactions', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  userId: text('user_id').notNull(),
  userInput: text('user_input').notNull(),
  rewrittenInput: text('rewritten_input'),
  routeAction: text('route_action', { enum: ['cheap', 'escalation', 'compare', 'draft', 'local', 'manual'] }).notNull(),
  routeReason: text('route_reason'),
  targetModel: text('target_model').notNull(),
  response: text('response').notNull(),
  escalationResponse: text('escalation_response'),
  responseLatencyMs: integer('response_latency_ms'),
  escalationLatencyMs: integer('escalation_latency_ms'),
  feedback: text('feedback'),
  critique: text('critique'),
  metadata: text('metadata').default('{}'),
  createdAt: text('created_at').notNull().default(sql`datetime('now')`),
}, (table) => [
  index('idx_interactions_user').on(table.userId, table.createdAt),
  index('idx_interactions_session').on(table.sessionId, table.createdAt),
  index('idx_interactions_action').on(table.routeAction, table.feedback),
]);

// ─── Routing Rules ────────────────────────────────────────────

export const routingRules = sqliteTable('routing_rules', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().default('_system'),
  name: text('name').notNull(),
  pattern: text('pattern').notNull(),
  action: text('action', { enum: ['cheap', 'escalation', 'compare', 'draft', 'local', 'manual'] }).notNull(),
  confidence: real('confidence').notNull().default(0.5),
  source: text('source', { enum: ['static', 'learned', 'manual'] }).notNull().default('static'),
  enabled: integer('enabled').notNull().default(1),
  hitCount: integer('hit_count').notNull().default(0),
  correctCount: integer('correct_count').notNull().default(0),
  createdAt: text('created_at').notNull().default(sql`datetime('now')`),
  updatedAt: text('updated_at').notNull().default(sql`datetime('now')`),
}, (table) => [
  index('idx_routing_user').on(table.userId, table.enabled),
  index('idx_routing_source').on(table.source, table.action),
]);

// ─── Providers ────────────────────────────────────────────────

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().default('_system'),
  name: text('name').notNull(),
  providerType: text('provider_type').notNull(),
  baseUrl: text('base_url').notNull(),
  model: text('model').notNull(),
  apiKeyEncrypted: text('api_key_encrypted'),
  temperature: real('temperature').notNull().default(0.7),
  maxTokens: integer('max_tokens').notNull().default(4096),
  capabilities: text('capabilities').default('[]'),
  enabled: integer('enabled').notNull().default(1),
  priority: integer('priority').notNull().default(0),
  metadata: text('metadata').default('{}'),
  createdAt: text('created_at').notNull().default(sql`datetime('now')`),
}, (table) => [
  index('idx_providers_user').on(table.userId, table.enabled),
]);

// ─── Provider Health ──────────────────────────────────────────

export const providerHealth = sqliteTable('provider_health', {
  providerId: text('provider_id').notNull().references(() => providers.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().default('_system'),
  successCount: integer('success_count').notNull().default(0),
  failureCount: integer('failure_count').notNull().default(0),
  avgLatencyMs: integer('avg_latency_ms'),
  totalRequests: integer('total_requests').notNull().default(0),
  degradationStart: text('degradation_start'),
  recoveryThreshold: integer('recovery_threshold').notNull().default(3),
  status: text('status', { enum: ['healthy', 'degraded', 'offline'] }).notNull().default('healthy'),
  lastCheckAt: text('last_check_at'),
  lastSuccessAt: text('last_success_at'),
  lastFailureAt: text('last_failure_at'),
  updatedAt: text('updated_at').notNull().default(sql`datetime('now')`),
}, (table) => [
  primaryKey({ columns: [table.providerId, table.userId] }),
]);

// ─── Agent Registry ───────────────────────────────────────────

export const agentRegistry = sqliteTable('agent_registry', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  agentType: text('agent_type', { enum: ['local', 'cloud', 'hybrid'] }).notNull(),
  endpoint: text('endpoint'),
  capabilities: text('capabilities').default('[]'),
  status: text('status', { enum: ['online', 'degraded', 'offline'] }).notNull().default('offline'),
  priority: integer('priority').notNull().default(0),
  metadata: text('metadata').default('{}'),
  createdAt: text('created_at').notNull().default(sql`datetime('now')`),
  updatedAt: text('updated_at').notNull().default(sql`datetime('now')`),
}, (table) => [
  index('idx_agents_user').on(table.userId, table.status),
]);

// ─── Agent Health ─────────────────────────────────────────────

export const agentHealth = sqliteTable('agent_health', {
  agentId: text('agent_id').notNull().references(() => agentRegistry.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),
  status: text('status', { enum: ['online', 'degraded', 'offline'] }).notNull(),
  latencyMs: integer('latency_ms'),
  metadata: text('metadata').default('{}'),
  checkedAt: text('checked_at').notNull().default(sql`datetime('now')`),
}, (table) => [
  primaryKey({ columns: [table.agentId, table.checkedAt] }),
]);

// ─── Training Exports ─────────────────────────────────────────

export const trainingExports = sqliteTable('training_exports', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  format: text('format', { enum: ['lora_jsonl', 'dpo_pairs', 'csv'] }).notNull(),
  recordCount: integer('record_count').notNull().default(0),
  qualityScoreAvg: real('quality_score_avg'),
  filePath: text('file_path'),
  metadata: text('metadata').default('{}'),
  createdAt: text('created_at').notNull().default(sql`datetime('now')`),
}, (table) => [
  index('idx_exports_user').on(table.userId, table.createdAt),
]);

// ─── Infer types ──────────────────────────────────────────────

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Interaction = typeof interactions.$inferSelect;
export type PIIEntity = typeof piiEntities.$inferSelect;
export type RoutingRule = typeof routingRules.$inferSelect;
export type Provider = typeof providers.$inferSelect;
export type UserPreference = typeof userPreferences.$inferSelect;

// Helper for raw SQL in Drizzle
function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return strings.join('?');
}
