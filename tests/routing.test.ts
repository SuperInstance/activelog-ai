import { describe, it, expect } from 'vitest';
import { classify, classifyOnly, checkCommandPrefix, checkStaticRules, STATIC_RULES } from '../src/routing/router';
import type { RoutingAction } from '../src/types';

describe('Router - classify', () => {
  // ─── Command prefix overrides ──────────────────────────────────────────

  describe('command prefixes', () => {
    it('should classify /draft prefix', () => {
      const { classification, message } = classify('/draft write a blog post about AI');
      expect(classification.action).toBe('draft');
      expect(classification.confidence).toBe(1.0);
      expect(classification.reason).toContain('/draft');
      expect(message).toBe('write a blog post about AI');
    });

    it('should classify /local prefix', () => {
      const { classification, message } = classify('/local analyze my photo');
      expect(classification.action).toBe('local');
      expect(classification.confidence).toBe(1.0);
      expect(message).toBe('analyze my photo');
    });

    it('should classify /compare prefix', () => {
      const { classification, message } = classify('/compare explain quantum computing');
      expect(classification.action).toBe('compare');
      expect(classification.confidence).toBe(1.0);
      expect(message).toBe('explain quantum computing');
    });

    it('should classify /manual prefix', () => {
      const { classification, message } = classify('/manual should I use React or Vue?');
      expect(classification.action).toBe('manual');
      expect(classification.confidence).toBe(1.0);
      expect(message).toBe('should I use React or Vue?');
    });

    it('command prefix should override any static rule match', () => {
      const { classification } = classify('/draft debug my broken code');
      expect(classification.action).toBe('draft');
      expect(classification.confidence).toBe(1.0);
    });
  });

  // ─── Static rules (14) ────────────────────────────────────────────────

  describe('static rules', () => {
    // Rule 1: Code Generation
    it('rule 1: code generation → escalation', () => {
      expect(classifyOnly('Write a function that sorts an array').action).toBe('escalation');
      expect(classifyOnly('Create an API endpoint for users').action).toBe('escalation');
      expect(classifyOnly('Build a React component').action).toBe('escalation');
      expect(classifyOnly('implement a handler for webhooks').action).toBe('escalation');
    });

    // Rule 2: Debug Request
    it('rule 2: debug request → escalation', () => {
      expect(classifyOnly('Debug this error in my code').action).toBe('escalation');
      expect(classifyOnly('Fix the crash in production').action).toBe('escalation');
      expect(classifyOnly('I have a bug in my function').action).toBe('escalation');
      expect(classifyOnly('traceback: FileNotFoundError').action).toBe('escalation');
      expect(classifyOnly('Help, the app is broken').action).toBe('escalation');
    });

    // Rule 3: Code Review
    it('rule 3: code review → escalation', () => {
      expect(classifyOnly('Review this code for issues').action).toBe('escalation');
      expect(classifyOnly('Refactor this function').action).toBe('escalation');
      expect(classifyOnly('Optimize this module for performance').action).toBe('escalation');
    });

    // Rule 4: Mathematical Reasoning
    it('rule 4: math reasoning → escalation', () => {
      expect(classifyOnly('Calculate the integral of x^2').action).toBe('escalation');
      expect(classifyOnly('Solve the equation 2x + 5 = 13').action).toBe('escalation');
      expect(classifyOnly('Prove that the square root of 2 is irrational').action).toBe('escalation');
      expect(classifyOnly('Derive the formula for compound interest').action).toBe('escalation');
    });

    // Rule 5: Complex Analysis
    it('rule 5: complex analysis → escalation', () => {
      expect(classifyOnly('Analyze the pros and cons of microservices').action).toBe('escalation');
      expect(classifyOnly('Evaluate these two approaches').action).toBe('escalation');
      expect(classifyOnly('Critique this argument').action).toBe('escalation');
    });

    // Rule 6: Creative Writing
    it('rule 6: creative writing → escalation', () => {
      expect(classifyOnly('Write a story about a robot').action).toBe('escalation');
      expect(classifyOnly('Compose a poem about nature').action).toBe('escalation');
      expect(classifyOnly('Draft an essay on climate change').action).toBe('escalation');
      expect(classifyOnly('Create a blog post about AI').action).toBe('escalation');
    });

    // Rule 7: Translation → cheap
    it('rule 7: translation → cheap', () => {
      expect(classifyOnly('Translate this to Spanish').action).toBe('cheap');
      expect(classifyOnly('Convert from French to German').action).toBe('cheap');
      expect(classifyOnly('Translate into Chinese').action).toBe('cheap');
    });

    // Rule 8: Summarization → cheap
    it('rule 8: summarization → cheap', () => {
      expect(classifyOnly('Summarize this article').action).toBe('cheap');
      expect(classifyOnly('TL;DR this document').action).toBe('cheap');
      expect(classifyOnly('Give me a brief recap').action).toBe('cheap');
      expect(classifyOnly('Condense this text').action).toBe('cheap');
    });

    // Rule 9: Simple Q&A → cheap
    it('rule 9: simple Q&A → cheap', () => {
      expect(classifyOnly('What is the capital of France?').action).toBe('cheap');
      expect(classifyOnly('Explain how DNS works').action).toBe('cheap');
      expect(classifyOnly('Define what a closure is').action).toBe('cheap');
    });

    // Rule 10: Factual Lookup → cheap
    it('rule 10: factual lookup → cheap', () => {
      expect(classifyOnly('What?').action).toBe('cheap');
      expect(classifyOnly('Who wrote Hamlet?').action).toBe('cheap');
      expect(classifyOnly('How many planets are there?').action).toBe('cheap');
    });

    // Rule 11: Chat/Social → cheap
    it('rule 11: chat/social → cheap', () => {
      expect(classifyOnly('Hello!').action).toBe('cheap');
      expect(classifyOnly('Hey there').action).toBe('cheap');
      expect(classifyOnly('Thanks for your help').action).toBe('cheap');
      expect(classifyOnly('Good morning!').action).toBe('cheap');
      expect(classifyOnly('How are you?').action).toBe('cheap');
    });

    // Rule 12: List/Enumeration → cheap
    it('rule 12: list/enumeration → cheap', () => {
      expect(classifyOnly('List the top 5 programming languages').action).toBe('cheap');
      expect(classifyOnly('Give me a few examples').action).toBe('cheap');
      expect(classifyOnly('Name some databases').action).toBe('cheap');
      expect(classifyOnly('Enumerate 3 benefits of REST').action).toBe('cheap');
    });

    // Rule 13: Instruction Following → escalation
    it('rule 13: instruction following → escalation', () => {
      expect(classifyOnly('Set up a PostgreSQL database').action).toBe('escalation');
      expect(classifyOnly('Configure Nginx as a reverse proxy').action).toBe('escalation');
      expect(classifyOnly('How to deploy to Cloudflare Workers').action).toBe('escalation');
    });

    // Rule 14: Privacy-Sensitive → local
    it('rule 14: privacy-sensitive → local', () => {
      expect(classifyOnly('My password is hunter2').action).toBe('local');
      expect(classifyOnly('My SSN is 123-45-6789').action).toBe('local');
      expect(classifyOnly('My credit card number is...').action).toBe('local');
      expect(classifyOnly('I have a medical diagnosis').action).toBe('local');
    });
  });

  // ─── Confidence scores ────────────────────────────────────────────────

  describe('confidence scores', () => {
    it('math reasoning should have highest confidence among escalation rules', () => {
      const c = classifyOnly('Calculate the integral');
      expect(c.confidence).toBe(0.9);
    });

    it('chat/social should have confidence 0.9', () => {
      const c = classifyOnly('hello');
      expect(c.confidence).toBe(0.9);
    });

    it('default fallback should have low confidence', () => {
      const c = classifyOnly('xyzzy plugh');
      expect(c.action).toBe('cheap');
      expect(c.confidence).toBe(0.3);
    });

    it('command prefix should always have confidence 1.0', () => {
      const c = classifyOnly('/draft anything');
      expect(c.confidence).toBe(1.0);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('empty message should default to cheap', () => {
      const c = classifyOnly('');
      expect(c.action).toBe('cheap');
      expect(c.confidence).toBe(0.3);
    });

    it('very long message should still classify', () => {
      const longMsg = 'debug '.repeat(1000) + 'my code';
      const c = classifyOnly(longMsg);
      expect(c.action).toBe('escalation');
    });

    it('special characters should not break classification', () => {
      const c = classifyOnly('<script>alert("hello")</script>');
      expect(['cheap', 'escalation']).toContain(c.action);
    });

    it('emoji-only message should default to cheap', () => {
      const c = classifyOnly('👋🎉');
      expect(c.action).toBe('cheap');
    });

    it('case insensitive matching', () => {
      expect(classifyOnly('WRITE A FUNCTION').action).toBe('escalation');
      expect(classifyOnly('Debug This Error').action).toBe('escalation');
      expect(classifyOnly('HELLO there').action).toBe('cheap');
    });

    it('returns message unchanged when no prefix', () => {
      const { message } = classify('fix my code');
      expect(message).toBe('fix my code');
    });
  });

  // ─── Rule ordering ────────────────────────────────────────────────────

  describe('rule ordering', () => {
    it('should have exactly 14 static rules', () => {
      expect(STATIC_RULES).toHaveLength(14);
    });

    it('first match wins (creative writing before simple Q&A)', () => {
      // "write" appears in both rules, but "story" should trigger creative writing
      const c = classifyOnly('Write a story about something');
      expect(c.action).toBe('escalation');
      expect(c.reason).toContain('creative_writing');
    });
  });

  // ─── checkStaticRules and checkCommandPrefix directly ─────────────────

  describe('direct function access', () => {
    it('checkCommandPrefix returns null for non-prefix messages', () => {
      expect(checkCommandPrefix('hello world')).toBeNull();
    });

    it('checkStaticRules returns null for unmatched message', () => {
      expect(checkStaticRules('xyzzy')).toBeNull();
    });
  });
});
