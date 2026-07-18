import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detect, dehydrate, rehydrate } from '../src/pii/engine';
import type { PIIType } from '../src/types';

// ─── Mock D1Database ───────────────────────────────────────────────────────

function createMockDB(existingEntities: Array<{ entity_id: string; entity_type: string; real_value: string }> = []) {
  const all = new Map<string, unknown[]>();
  all.set('count', existingEntities.map((e) => ({ entity_type: e.entity_type, cnt: 1 })));

  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: all.get('count') ?? [],
        }),
        first: vi.fn().mockResolvedValue(null),
        run: vi.fn().mockResolvedValue({}),
      }),
    }),
  } as unknown as D1Database;
}

// ─── Detect tests ──────────────────────────────────────────────────────────

describe('PII Engine - detect', () => {
  it('detects email addresses', () => {
    const matches = detect('Contact me at john.doe@example.com please');
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((m) => m.type === 'email')).toBe(true);
    expect(matches.find((m) => m.type === 'email')!.value).toBe('john.doe@example.com');
  });

  it('detects phone numbers (US format)', () => {
    const matches = detect('Call me at (555) 123-4567');
    expect(matches.some((m) => m.type === 'phone')).toBe(true);
  });

  it('detects SSN', () => {
    const matches = detect('My SSN is 123-45-6789');
    expect(matches.some((m) => m.type === 'ssn')).toBe(true);
  });

  it('detects credit card numbers (dashed)', () => {
    const matches = detect('Card: 4111-1111-1111-1111');
    expect(matches.some((m) => m.type === 'credit_card')).toBe(true);
  });

  it('detects API keys (OpenAI-style)', () => {
    const matches = detect('Use this key: sk-proj-abcdefghijklmnopqrstuvwxyz123456');
    expect(matches.some((m) => m.type === 'api_key')).toBe(true);
  });

  it('detects contextual person names ("my name is...")', () => {
    const matches = detect('My name is John Smith');
    expect(matches.some((m) => m.type === 'person')).toBe(true);
  });

  it('detects person names with honorifics', () => {
    const matches = detect('Please ask Dr. Johnson about the results');
    expect(matches.some((m) => m.type === 'person')).toBe(true);
  });

  it('detects IP addresses', () => {
    const matches = detect('Server at 192.168.1.100');
    expect(matches.some((m) => m.type === 'ip_address')).toBe(true);
  });

  it('detects dates (ISO format)', () => {
    const matches = detect('The event is on 2026-03-25');
    expect(matches.some((m) => m.type === 'date')).toBe(true);
  });

  it('detects dates (US format)', () => {
    const matches = detect('Birthday: 12/25/1990');
    expect(matches.some((m) => m.type === 'date')).toBe(true);
  });

  it('returns empty array for no PII', () => {
    const matches = detect('Hello, how are you today?');
    expect(matches.length).toBe(0);
  });

  it('handles mixed PII types', () => {
    const text = 'Email john@test.com or call (555) 999-0000. SSN: 111-22-3333';
    const matches = detect(text);
    const types = new Set(matches.map((m) => m.type));
    expect(types.has('email')).toBe(true);
    expect(types.has('phone')).toBe(true);
    expect(types.has('ssn')).toBe(true);
  });

  it('detects Chinese names', () => {
    const matches = detect('我的朋友叫张伟');
    expect(matches.some((m) => m.type === 'chinese_name')).toBe(true);
  });

  it('detects Russian names', () => {
    const matches = detect('Привет, Иван-Петр');
    expect(matches.some((m) => m.type === 'russian_name')).toBe(true);
  });

  it('rejects 16-digit strings that fail Luhn check', () => {
    const matches = detect('ID number: 1234567890123456');
    expect(matches.some((m) => m.type === 'credit_card' && m.value === '1234567890123456')).toBe(false);
  });

  it('matches are sorted by position descending', () => {
    const matches = detect('Email a@b.com and phone (555) 111-2222');
    if (matches.length >= 2) {
      expect(matches[0].start).toBeGreaterThan(matches[1].start);
    }
  });
});

// ─── Dehydrate tests ──────────────────────────────────────────────────────

describe('PII Engine - dehydrate', () => {
  it('replaces PII with entity IDs', async () => {
    const db = createMockDB();
    const result = await dehydrate('Contact john@test.com today', db);

    expect(result.text).not.toContain('john@test.com');
    expect(result.text).toContain('[EMAIL_');
    expect(result.entities.length).toBeGreaterThanOrEqual(1);
  });

  it('injects preamble when PII is found', async () => {
    const db = createMockDB();
    const result = await dehydrate('Email john@test.com', db);

    expect(result.preamble).toContain('PII placeholders');
    expect(result.preamble).toContain('[TYPE_ID]');
  });

  it('returns empty preamble when no PII found', async () => {
    const db = createMockDB();
    const result = await dehydrate('Hello world', db);

    expect(result.preamble).toBe('');
    expect(result.entities).toHaveLength(0);
    expect(result.text).toBe('Hello world');
  });

  it('generates correct entity IDs', async () => {
    const db = createMockDB();
    const result = await dehydrate('Email john@test.com and jane@test.com', db);

    const emailEntities = result.entities.filter((e) => e.type === 'email');
    expect(emailEntities.length).toBe(2);
    // Should have sequential IDs
    expect(emailEntities[0].entityId).toBe('[EMAIL_1]');
    expect(emailEntities[1].entityId).toBe('[EMAIL_2]');
  });

  it('handles multiple PII types in one message', async () => {
    const db = createMockDB();
    const result = await dehydrate('Email john@test.com, call (555) 123-4567', db);

    const types = new Set(result.entities.map((e) => e.type));
    expect(types.has('email')).toBe(true);
    expect(types.has('phone')).toBe(true);
  });

  it('calls db.prepare.run for each entity', async () => {
    const db = createMockDB();
    await dehydrate('Email john@test.com', db);

    const prepare = (db.prepare as ReturnType<typeof vi.fn>);
    expect(prepare).toHaveBeenCalled();
  });
});

// ─── Rehydrate tests ───────────────────────────────────────────────────────

describe('PII Engine - rehydrate', () => {
  function createRehydrateMock(entities: Array<{ entity_id: string; real_value: string }> = []) {
    const mockAll = vi.fn().mockResolvedValue({ results: entities });
    const stmt = {
      bind: vi.fn().mockImplementation((...args) => {
        console.log('bind called with:', args);
        return { all: mockAll, first: vi.fn(), run: vi.fn() };
      }),
    };
    const prepare = vi.fn().mockImplementation((sql) => {
      console.log('prepare called with:', sql);
      return stmt;
    });
    return { db: { prepare } as unknown as D1Database, mockAll };
  }

  it('restores entity IDs to real values', async () => {
    const { db, mockAll } = createRehydrateMock([{ entity_id: 'EMAIL_1', real_value: 'john@test.com' }]);
    console.log('db.prepare is function?', typeof db.prepare);
    console.log('db.prepare mock?', vi.isMockFunction(db.prepare));
    const result = await rehydrate('Contact [EMAIL_1] please', db);
    // Debug
    const calls = mockAll.mock.calls;
    console.log('mockAll calls:', calls.length);
    if (calls.length > 0) {
      const resolved = await mockAll.mock.results[0]?.value;
      console.log('mockAll result:', JSON.stringify(resolved));
    }
    console.log('Result:', JSON.stringify(result));
    expect(result).toBe('Contact john@test.com please');
  });

  it('returns text unchanged when no tokens present', async () => {
    const { db } = createRehydrateMock();
    const result = await rehydrate('Hello world', db);
    expect(result).toBe('Hello world');
  });

  it('returns text unchanged when DB has no matching entities', async () => {
    const { db } = createRehydrateMock([]);
    const result = await rehydrate('Contact [EMAIL_1] please', db);
    expect(result).toBe('Contact [EMAIL_1] please');
  });

  it('replaces multiple different entity types', async () => {
    const { db } = createRehydrateMock([
      { entity_id: 'EMAIL_1', real_value: 'john@test.com' },
      { entity_id: 'PHONE_1', real_value: '(555) 123-4567' },
    ]);
    const result = await rehydrate('Email [EMAIL_1] or call [PHONE_1]', db);
    expect(result).toContain('john@test.com');
    expect(result).toContain('(555) 123-4567');
    expect(result).not.toContain('[EMAIL_1]');
    expect(result).not.toContain('[PHONE_1]');
  });
});

// ─── Roundtrip test ────────────────────────────────────────────────────────

describe('PII Engine - roundtrip', () => {
  it('dehydrate then rehydrate preserves non-PII text', async () => {
    const dehydrateDb = createMockDB();

    const mockAll = vi.fn().mockResolvedValue({
      results: [{ entity_id: 'EMAIL_1', real_value: 'john@test.com' }],
    });
    const stmt = { bind: vi.fn().mockReturnValue({ all: mockAll, first: vi.fn(), run: vi.fn() }) };
    const rehydrateDb = { prepare: vi.fn().mockReturnValue(stmt) } as unknown as D1Database;

    const dehydrated = await dehydrate('Hello! Please email john@test.com today.', dehydrateDb);
    const rehydrated = await rehydrate(dehydrated.text, rehydrateDb);

    expect(rehydrated).toContain('Hello!');
    expect(rehydrated).toContain('Please email');
    expect(rehydrated).toContain('today');
    expect(rehydrated).toContain('john@test.com');
  });
});
