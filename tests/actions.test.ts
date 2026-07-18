import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseActionStream, repairJson } from '../src/actions/parser.js';
import type { Action } from '../src/actions/types.js';
import {
  isAction, isNarration, isDiceRoll, isCombat, isSpeech, isQuestion,
  isQuiz, isHighlight, isTimer, isProgress, isSceneTransition, isInitiative,
  isMapReveal, isNpcAction, isInventoryChange, isAmbient, isCharacterUpdate,
  isFlashback, isSlide, isWhiteboard, isCodeBlock, isInteractive, isFlashcard,
  isSpacedReview, isExercise, isReference, isBlocking, getDomain,
  filterByDomain, ttrpgActions, studyActions, BLOCKING_ACTIONS,
} from '../src/actions/types.js';
import {
  actionTypeToComponent, actionPriority, actionSortKey,
} from '../src/actions/renderer.js';
import {
  encodeActionStart, encodeActionDelta, encodeActionComplete,
  encodeActionError, decodeSSEEvent, parseSSEStream,
} from '../src/actions/sse.js';
import { extractSessionState, applyAction, createEmptySessionState } from '../src/actions/state.js';

// ─── Parser Tests ─────────────────────────────────────────────────────────

describe('parseActionStream', () => {
  it('parses a valid JSON array', () => {
    const input = JSON.stringify([
      { type: 'narration', payload: { text: 'Hello world' } },
      { type: 'dice_roll', payload: { notation: '1d20', rolls: [17], modifier: 3, total: 20 } },
    ]);
    const { actions, unparsed } = parseActionStream(input);
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe('narration');
    expect(actions[1].type).toBe('dice_roll');
    expect(unparsed).toHaveLength(0);
  });

  it('auto-generates meta.id for actions without one', () => {
    const input = JSON.stringify([
      { type: 'narration', payload: { text: 'test' } },
    ]);
    const { actions } = parseActionStream(input);
    expect(actions[0].meta?.id).toBeDefined();
    expect(actions[0].meta!.id).toMatch(/^act_/);
  });

  it('preserves existing meta.id', () => {
    const input = JSON.stringify([
      { type: 'narration', payload: { text: 'test' }, meta: { id: 'my-custom-id' } },
    ]);
    const { actions } = parseActionStream(input);
    expect(actions[0].meta?.id).toBe('my-custom-id');
  });

  it('handles empty input', () => {
    const { actions, unparsed } = parseActionStream('');
    expect(actions).toHaveLength(0);
    expect(unparsed).toHaveLength(0);
  });

  it('handles null/undefined input', () => {
    const { actions } = parseActionStream(null as any);
    expect(actions).toHaveLength(0);
    const { actions: a2 } = parseActionStream(undefined as any);
    expect(a2).toHaveLength(0);
  });

  it('handles non-JSON text as unparsed', () => {
    const { actions, unparsed } = parseActionStream('Just some random text');
    expect(actions).toHaveLength(0);
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]).toContain('random text');
  });

  it('extracts JSON from fenced code blocks', () => {
    const input = 'The dragon roars. ```json\n[{"type":"narration","payload":{"text":"Rawr!"}}]\n```';
    const { actions, unparsed } = parseActionStream(input);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('narration');
    expect(actions[0].payload.text).toBe('Rawr!');
  });

  it('extracts JSON from fenced code blocks without language tag', () => {
    const input = 'Here is the output:\n```\n[{"type":"narration","payload":{"text":"Hello"}}]\n```';
    const { actions } = parseActionStream(input);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('narration');
  });

  it('collects text before and after JSON as unparsed', () => {
    const input = 'Before text\n[{"type":"narration","payload":{"text":"Action"}}]\nAfter text';
    const { actions, unparsed } = parseActionStream(input);
    expect(actions).toHaveLength(1);
    expect(unparsed.length).toBeGreaterThanOrEqual(1);
  });

  it('repairs trailing commas', () => {
    const input = '[{"type":"narration","payload":{"text":"hello",}},]';
    const { actions } = parseActionStream(input);
    expect(actions).toHaveLength(1);
  });

  it('repairs unquoted keys', () => {
    const input = '[{type: "narration", payload: {text: "hello"}}]';
    const { actions } = parseActionStream(input);
    expect(actions).toHaveLength(1);
  });

  it('handles truncated JSON (missing closing brackets)', () => {
    const input = '[{"type":"narration","payload":{"text":"hello"}';
    const { actions } = parseActionStream(input);
    expect(actions).toHaveLength(1);
  });

  it('handles truncated JSON with trailing comma', () => {
    const input = '[{"type":"narration","payload":{"text":"hello"}},';
    const { actions } = parseActionStream(input);
    expect(actions).toHaveLength(1);
  });

  it('rejects actions with unknown type', () => {
    const input = JSON.stringify([
      { type: 'unknown_type', payload: {} },
    ]);
    const { actions } = parseActionStream(input);
    expect(actions).toHaveLength(0);
  });

  it('rejects actions missing required payload fields', () => {
    const input = JSON.stringify([
      { type: 'narration', payload: {} },  // missing 'text'
    ]);
    const { actions } = parseActionStream(input);
    expect(actions).toHaveLength(0);
  });

  it('salvages plain strings in array as narration', () => {
    const input = JSON.stringify(['Hello world', { type: 'narration', payload: { text: 'Second' } }]);
    const { actions } = parseActionStream(input);
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe('narration');
    expect(actions[0].payload.text).toBe('Hello world');
  });

  it('salvages objects with text field as narration', () => {
    const input = JSON.stringify([{ text: 'Salvaged text', style: 'prose' }]);
    const { actions } = parseActionStream(input);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('narration');
  });

  it('handles complex real-world LLM output', () => {
    const input = `Here's what happens next:

\`\`\`json
[
  {"type": "narration", "payload": {"text": "## The Dragon's Lair", "style": "dramatic"}},
  {"type": "dice_roll", "payload": {"notation": "1d20+5", "rolls": [14], "modifier": 5, "total": 19, "reason": "Perception check", "success": true, "difficulty_class": 15}}
]
\`\`\`

The dragon stares at you menacingly.`;
    const { actions, unparsed } = parseActionStream(input);
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe('narration');
    expect(actions[1].type).toBe('dice_roll');
    expect(actions[1].payload.total).toBe(19);
  });
});

describe('repairJson', () => {
  it('removes trailing commas', () => {
    expect(repairJson('{"a":1,}')).toBe('{"a":1}');
    expect(repairJson('[1,2,]')).toBe('[1,2]');
  });

  it('quotes unquoted keys', () => {
    const result = repairJson('{foo: "bar"}');
    expect(result).toContain('"foo"');
  });

  it('removes control characters', () => {
    const result = repairJson('{"a":"hello\x00world"}');
    expect(result).not.toContain('\x00');
  });
});

// ─── Type Guard Tests ─────────────────────────────────────────────────────

describe('type guards', () => {
  const makeAction = (type: string, payload: Record<string, any>): Action =>
    ({ type: type as any, payload: payload as any });

  it('isAction returns true for valid actions', () => {
    expect(isAction(makeAction('narration', { text: 'x' }))).toBe(true);
  });

  it('isAction returns false for non-objects', () => {
    expect(isAction(null)).toBe(false);
    expect(isAction(42)).toBe(false);
    expect(isAction('string')).toBe(false);
  });

  it('isAction returns false for objects without type/payload', () => {
    expect(isAction({ foo: 'bar' })).toBe(false);
    expect(isAction({ type: 'narration' })).toBe(false);
  });

  it('isNarration works', () => {
    expect(isNarration(makeAction('narration', { text: 'x' }))).toBe(true);
    expect(isNarration(makeAction('dice_roll', { notation: '1d20', rolls: [], modifier: 0, total: 0 }))).toBe(false);
  });

  it('isDiceRoll works', () => {
    expect(isDiceRoll(makeAction('dice_roll', { notation: '1d20', rolls: [10], modifier: 3, total: 13 }))).toBe(true);
    expect(isDiceRoll(makeAction('narration', { text: 'x' }))).toBe(false);
  });

  it('isCombat works', () => {
    expect(isCombat(makeAction('combat_round', { round: 1, turns: [] }))).toBe(true);
    expect(isCombat(makeAction('narration', { text: 'x' }))).toBe(false);
  });

  it('isSpeech works', () => {
    expect(isSpeech(makeAction('speech', { character: 'A', character_id: 'a', text: 'Hi' }))).toBe(true);
    expect(isSpeech(makeAction('narration', { text: 'x' }))).toBe(false);
  });

  it('isQuestion works', () => {
    expect(isQuestion(makeAction('question', { prompt: 'What?' }))).toBe(true);
  });

  it('isQuiz works', () => {
    expect(isQuiz(makeAction('quiz', { id: 'q1', question: 'What?', type: 'single' }))).toBe(true);
  });

  it('isHighlight works', () => {
    expect(isHighlight(makeAction('highlight', { target: 'x', target_type: 'character' }))).toBe(true);
  });

  it('isTimer works', () => {
    expect(isTimer(makeAction('timer', { action: 'start' }))).toBe(true);
  });

  it('isProgress works', () => {
    expect(isProgress(makeAction('progress', { id: 'p1', value: 0.5 }))).toBe(true);
  });

  it('isSceneTransition works', () => {
    expect(isSceneTransition(makeAction('scene_transition', { scene_id: 's1', name: 'Test', description: 'A scene' }))).toBe(true);
  });

  it('isInitiative works', () => {
    expect(isInitiative(makeAction('initiative', { action: 'set' }))).toBe(true);
  });

  it('isMapReveal works', () => {
    expect(isMapReveal(makeAction('map_reveal', { map_id: 'm1', action: 'show' }))).toBe(true);
  });

  it('isNpcAction works', () => {
    expect(isNpcAction(makeAction('npc_action', { npc_id: 'n1', action: 'stand' }))).toBe(true);
  });

  it('isInventoryChange works', () => {
    expect(isInventoryChange(makeAction('inventory_change', { character_id: 'c1', action: 'add', item: { id: 'i1', name: 'Sword', type: 'weapon', quantity: 1 } }))).toBe(true);
  });

  it('isAmbient works', () => {
    expect(isAmbient(makeAction('ambient', { cue_id: 'c1', action: 'play' }))).toBe(true);
  });

  it('isCharacterUpdate works', () => {
    expect(isCharacterUpdate(makeAction('character_update', { character_id: 'c1', changes: [] }))).toBe(true);
  });

  it('isFlashback works', () => {
    expect(isFlashback(makeAction('flashback', { title: 'Memory' }))).toBe(true);
  });

  it('isSlide works', () => {
    expect(isSlide(makeAction('slide', { slide_number: 1, total_slides: 5, title: 'Intro' }))).toBe(true);
  });

  it('isWhiteboard works', () => {
    expect(isWhiteboard(makeAction('whiteboard', { action: 'draw' }))).toBe(true);
  });

  it('isCodeBlock works', () => {
    expect(isCodeBlock(makeAction('code_block', { language: 'ts', code: 'const x = 1' }))).toBe(true);
  });

  it('isInteractive works', () => {
    expect(isInteractive(makeAction('interactive', { id: 'w1', title: 'Widget', widget_type: 'html', source: '<div/>' }))).toBe(true);
  });

  it('isFlashcard works', () => {
    expect(isFlashcard(makeAction('flashcard', { deck: 'd1', card_id: 'c1', front: 'Q', back: 'A' }))).toBe(true);
  });

  it('isSpacedReview works', () => {
    expect(isSpacedReview(makeAction('spaced_review', { card_id: 'c1', rating: 3, algorithm: 'sm2', next_review: '2026-01-01', interval_days: 2 }))).toBe(true);
  });

  it('isExercise works', () => {
    expect(isExercise(makeAction('exercise', { id: 'e1', title: 'Ex', difficulty: 'easy', instructions: 'Do it' }))).toBe(true);
  });

  it('isReference works', () => {
    expect(isReference(makeAction('reference', { title: 'Ref', content: 'Content' }))).toBe(true);
  });

  it('isBlocking from types module uses BLOCKING_ACTIONS set', () => {
    const narration = makeAction('narration', { text: 'x' });
    const speech = makeAction('speech', { character: 'A', character_id: 'a', text: 'Hi' });
    expect(isBlocking(narration)).toBe(false);
    expect(isBlocking(speech)).toBe(true);
  });

  it('isBlocking respects meta.blocking override', () => {
    const narration = makeAction('narration', { text: 'x' });
    narration.meta = { blocking: true };
    expect(isBlocking(narration)).toBe(true);
  });

  it('getDomain returns correct domain', () => {
    expect(getDomain(makeAction('narration', { text: 'x' }))).toBe('shared');
    expect(getDomain(makeAction('dice_roll', { notation: '1d20', rolls: [], modifier: 0, total: 0 }))).toBe('ttrpg');
    expect(getDomain(makeAction('slide', { slide_number: 1, total_slides: 5, title: 'T' }))).toBe('study');
  });

  it('filterByDomain filters correctly', () => {
    const actions = [
      makeAction('narration', { text: 'x' }),
      makeAction('dice_roll', { notation: '1d20', rolls: [], modifier: 0, total: 0 }),
      makeAction('slide', { slide_number: 1, total_slides: 5, title: 'T' }),
    ];
    const ttrpg = filterByDomain(actions, 'ttrpg');
    expect(ttrpg).toHaveLength(2); // shared + ttrpg
    expect(ttrpg[1].type).toBe('dice_roll');

    const study = filterByDomain(actions, 'study');
    expect(study).toHaveLength(2);
    expect(study[1].type).toBe('slide');
  });

  it('ttrpgActions and studyActions work', () => {
    const actions = [
      makeAction('narration', { text: 'x' }),
      makeAction('dice_roll', { notation: '1d20', rolls: [], modifier: 0, total: 0 }),
      makeAction('flashcard', { deck: 'd', card_id: 'c', front: 'Q', back: 'A' }),
    ];
    expect(ttrpgActions(actions)).toHaveLength(2);
    expect(studyActions(actions)).toHaveLength(2);
  });
});

// ─── SSE Tests ────────────────────────────────────────────────────────────

describe('SSE encoding/decoding', () => {
  it('encodeActionStart produces valid SSE', () => {
    const action: Action = {
      type: 'narration',
      payload: { text: 'Hello', style: 'prose' },
      meta: { id: 'act_test' },
    };
    const encoded = encodeActionStart(action);
    expect(encoded).toContain('event: action_start');
    expect(encoded).toContain('"id":"act_test"');
    expect(encoded).toContain('"type":"narration"');
    expect(encoded).toMatch(/\n\n$/);
  });

  it('encodeActionDelta produces valid SSE', () => {
    const encoded = encodeActionDelta('act_test', { path: 'payload.text', value: 'world' });
    expect(encoded).toContain('event: action_delta');
    expect(encoded).toContain('"path":"payload.text"');
    expect(encoded).toContain('"value":"world"');
  });

  it('encodeActionComplete produces valid SSE', () => {
    const encoded = encodeActionComplete('act_test');
    expect(encoded).toContain('event: action_complete');
    expect(encoded).toContain('"id":"act_test"');
  });

  it('encodeActionError produces valid SSE', () => {
    const encoded = encodeActionError('act_test', new Error('parsing failed'));
    expect(encoded).toContain('event: action_error');
    expect(encoded).toContain('"error":"parsing failed"');
    expect(encoded).toContain('"recovery":"skip"');
  });

  it('decodeSSEEvent parses action_start', () => {
    const raw = 'event: action_start\ndata: {"id":"act_1","type":"narration","payload":{"text":"hi"}}\n\n';
    const event = decodeSSEEvent(raw);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('action_start');
    if (event!.type === 'action_start') {
      expect(event!.data.id).toBe('act_1');
      expect(event!.data.type).toBe('narration');
    }
  });

  it('decodeSSEEvent returns null for invalid input', () => {
    expect(decodeSSEEvent('')).toBeNull();
    expect(decodeSSEEvent('garbage')).toBeNull();
    expect(decodeSSEEvent('event: unknown\ndata: {}\n\n')).toBeNull();
  });

  it('roundtrip: encode then decode', () => {
    const action: Action = {
      type: 'dice_roll',
      payload: { notation: '2d6', rolls: [3, 4], modifier: 2, total: 9 },
      meta: { id: 'dice_1' },
    };
    const encoded = encodeActionStart(action);
    const event = decodeSSEEvent(encoded);
    expect(event).not.toBeNull();
    expect(event!.type).toBe('action_start');
    if (event!.type === 'action_start') {
      expect(event!.data.id).toBe('dice_1');
      expect(event!.data.type).toBe('dice_roll');
    }
  });

  it('parseSSEStream parses multiple events', () => {
    const stream =
      'event: action_start\ndata: {"id":"a1","type":"narration"}\n\n' +
      'event: action_delta\ndata: {"id":"a1","path":"payload.text","value":"Hello"}\n\n' +
      'event: action_complete\ndata: {"id":"a1"}\n\n';
    const events = parseSSEStream(stream);
    expect(events).toHaveLength(3);
    expect(events[0].type).toBe('action_start');
    expect(events[1].type).toBe('action_delta');
    expect(events[2].type).toBe('action_complete');
  });
});

// ─── State Extraction Tests ───────────────────────────────────────────────

describe('extractSessionState', () => {
  it('starts with empty state', () => {
    const state = createEmptySessionState();
    expect(state.currentScene).toBeNull();
    expect(state.characters).toEqual({});
    expect(state.initiative).toBeNull();
    expect(state.combat).toBeNull();
  });

  it('extracts scene from scene_transition', () => {
    const actions: Action[] = [
      { type: 'scene_transition', payload: { scene_id: 'tavern', name: 'The Rusty Anchor', description: 'Smoky tavern' } },
    ];
    const state = extractSessionState(actions);
    expect(state.currentScene).toBe('tavern');
    expect(state.sceneName).toBe('The Rusty Anchor');
  });

  it('tracks character HP changes', () => {
    const actions: Action[] = [
      { type: 'character_update', payload: { character_id: 'pc-1', changes: [
        { stat: 'hp', value: -5, reason: 'Hit', new_value: 25 },
      ] } },
    ];
    const state = extractSessionState(actions);
    expect(state.characters['pc-1'].hp).toBe(25);
  });

  it('tracks character conditions', () => {
    const actions: Action[] = [
      { type: 'character_update', payload: { character_id: 'pc-1', changes: [
        { stat: 'condition', value: 'poisoned', duration: 'until treated' },
      ] } },
    ];
    const state = extractSessionState(actions);
    expect(state.characters['pc-1'].conditions).toContain('poisoned');
  });

  it('sets initiative and combat state', () => {
    const actions: Action[] = [
      { type: 'initiative', payload: {
        action: 'set',
        order: [
          { id: 'goblin-1', name: 'Goblin', initiative: 18, hp: 7, max_hp: 7 },
          { id: 'pc-1', name: 'Hero', initiative: 12, hp: 30, max_hp: 30 },
        ],
        round: 1,
        current_turn: 0,
      } },
    ];
    const state = extractSessionState(actions);
    expect(state.initiative).not.toBeNull();
    expect(state.initiative!.order).toHaveLength(2);
    expect(state.combat!.active).toBe(true);
    expect(state.characters['pc-1'].hp).toBe(30);
  });

  it('ends combat on end_combat', () => {
    const actions: Action[] = [
      { type: 'initiative', payload: {
        action: 'set',
        order: [{ id: 'g1', name: 'G', initiative: 10, hp: 7, max_hp: 7 }],
        round: 1, current_turn: 0,
      } },
      { type: 'initiative', payload: { action: 'end_combat' } },
    ];
    const state = extractSessionState(actions);
    expect(state.initiative).toBeNull();
    expect(state.combat).toBeNull();
  });

  it('tracks inventory changes', () => {
    const actions: Action[] = [
      { type: 'inventory_change', payload: {
        character_id: 'pc-1', action: 'add',
        item: { id: 'sword-1', name: 'Longsword', type: 'weapon', quantity: 1 },
      } },
    ];
    const state = extractSessionState(actions);
    expect(state.characters['pc-1'].inventory).toHaveLength(1);
    expect(state.characters['pc-1'].inventory[0].name).toBe('Longsword');
  });

  it('handles inventory remove', () => {
    const actions: Action[] = [
      { type: 'inventory_change', payload: {
        character_id: 'pc-1', action: 'add',
        item: { id: 'sword-1', name: 'Longsword', type: 'weapon', quantity: 1 },
      } },
      { type: 'inventory_change', payload: {
        character_id: 'pc-1', action: 'remove',
        item: { id: 'sword-1' },
      } },
    ];
    const state = extractSessionState(actions);
    expect(state.characters['pc-1'].inventory).toHaveLength(0);
  });

  it('tracks slide progress', () => {
    const actions: Action[] = [
      { type: 'slide', payload: { slide_number: 3, total_slides: 10, title: 'React' } },
    ];
    const state = extractSessionState(actions);
    expect(state.currentSlide).toBe(3);
    expect(state.totalSlides).toBe(10);
  });

  it('tracks progress values', () => {
    const actions: Action[] = [
      { type: 'progress', payload: { id: 'lesson', value: 0.75 } },
    ];
    const state = extractSessionState(actions);
    expect(state.progress['lesson']).toBe(0.75);
  });

  it('tracks flashcard states', () => {
    const actions: Action[] = [
      { type: 'flashcard', payload: { deck: 'js', card_id: 'closures', front: 'Q', back: 'A', difficulty: 4, tags: ['fn'] } },
    ];
    const state = extractSessionState(actions);
    expect(state.flashcardStates['closures']).toBeDefined();
    expect(state.flashcardStates['closures'].difficulty).toBe(4);
  });

  it('tracks exercise completion', () => {
    const actions: Action[] = [
      { type: 'exercise', payload: { id: 'ex-1', title: 'Stack', difficulty: 'medium', instructions: 'Build a stack' } },
    ];
    const state = extractSessionState(actions);
    expect(state.exercisesCompleted).toContain('ex-1');
  });

  it('tracks spaced review schedule', () => {
    const actions: Action[] = [
      { type: 'spaced_review', payload: { card_id: 'c1', rating: 3, algorithm: 'sm2', next_review: '2026-03-28', interval_days: 2 } },
    ];
    const state = extractSessionState(actions);
    expect(state.reviewSchedule['c1']).toBeDefined();
    expect(state.reviewSchedule['c1'].interval_days).toBe(2);
  });

  it('applyAction returns new state without mutating original', () => {
    const state = createEmptySessionState();
    const action: Action = {
      type: 'scene_transition',
      payload: { scene_id: 'forest', name: 'Dark Forest', description: 'Scary' },
    };
    const newState = applyAction(state, action);
    expect(state.currentScene).toBeNull(); // original unchanged
    expect(newState.currentScene).toBe('forest');
  });

  it('tracks timer start', () => {
    const actions: Action[] = [
      { type: 'timer', payload: { action: 'start', duration_ms: 60000, label: 'Combat Round' } },
    ];
    const state = extractSessionState(actions);
    expect(state.timers['Combat Round']).toBeDefined();
    expect(state.timers['Combat Round'].duration_ms).toBe(60000);
  });

  it('timer cancel removes timer', () => {
    const actions: Action[] = [
      { type: 'timer', payload: { action: 'start', duration_ms: 60000, label: 'Round' } },
      { type: 'timer', payload: { action: 'cancel', label: 'Round' } },
    ];
    const state = extractSessionState(actions);
    expect(state.timers['Round']).toBeUndefined();
  });
});

// ─── Renderer Tests ───────────────────────────────────────────────────────

describe('renderer', () => {
  it('actionTypeToComponent returns component name for all types', () => {
    const types = [
      'narration', 'speech', 'question', 'quiz', 'highlight', 'timer', 'progress',
      'scene_transition', 'dice_roll', 'initiative', 'combat_round', 'map_reveal',
      'npc_action', 'inventory_change', 'ambient', 'character_update', 'flashback',
      'slide', 'whiteboard', 'code_block', 'interactive', 'flashcard',
      'spaced_review', 'exercise', 'reference',
    ];
    for (const t of types) {
      const action = { type: t, payload: {} } as Action;
      const component = actionTypeToComponent(action);
      expect(component).toBeTruthy();
      expect(component).toMatch(/^[A-Z]/);
    }
  });

  it('actionPriority returns a number for all action types', () => {
    const types = [
      'narration', 'speech', 'dice_roll', 'scene_transition', 'timer',
      'combat_round', 'highlight', 'reference', 'ambient',
    ];
    for (const t of types) {
      const action = { type: t, payload: {} } as Action;
      const priority = actionPriority(action);
      expect(priority).toBeGreaterThanOrEqual(0);
      expect(priority).toBeLessThanOrEqual(10);
    }
  });

  it('actionPriority uses meta.priority when set', () => {
    const action = { type: 'narration', payload: { text: 'x' }, meta: { priority: 10 } } as Action;
    expect(actionPriority(action)).toBe(10);
  });

  it('scene_transition has high priority', () => {
    const action = { type: 'scene_transition', payload: { scene_id: 's', name: 'S', description: 'D' } } as Action;
    expect(actionPriority(action)).toBeGreaterThanOrEqual(8);
  });

  it('reference has low priority', () => {
    const action = { type: 'reference', payload: { title: 'R', content: 'C' } } as Action;
    expect(actionPriority(action)).toBeLessThanOrEqual(2);
  });

  it('actionSortKey produces stable keys', () => {
    const action = { type: 'narration', payload: { text: 'x' } } as Action;
    const key1 = actionSortKey(action, 0);
    const key2 = actionSortKey(action, 1);
    expect(key1).not.toBe(key2);
  });

  it('higher priority actions sort before lower priority', () => {
    const scene = { type: 'scene_transition', payload: { scene_id: 's', name: 'S', description: 'D' } } as Action;
    const narration = { type: 'narration', payload: { text: 'x' } } as Action;
    const key1 = actionSortKey(scene, 5);
    const key2 = actionSortKey(narration, 0);
    expect(key1 < key2).toBe(true);
  });
});
