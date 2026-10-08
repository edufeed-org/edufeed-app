/** @vitest-environment node */
/**
 * call-broadcasts.js — kind 20002 call broadcasts: the template a host
 * publishes to the parent group, the filter every client in the session
 * keeps, the parser's validation, and the countdown marks the host seat
 * sends on its own.
 */
import { describe, it, expect } from 'vitest';
import {
  CALL_BROADCAST_KIND,
  COUNTDOWN_MARKS,
  buildCallBroadcastTemplate,
  callBroadcastFilter,
  parseCallBroadcast,
  countdownDue
} from '$lib/groups/call-broadcasts.js';

const PK = 'a'.repeat(64);
/** @param {string[][]} tags @param {string} [content] */
const event = (tags, content = '') => ({
  id: 'ev',
  kind: CALL_BROADCAST_KIND,
  pubkey: PK,
  created_at: 1700000000,
  content,
  tags
});

describe('template and filter', () => {
  it('addresses the parent with exactly one h tag and the type', () => {
    const t = buildCallBroadcastTemplate('main', 'message', 'two minutes left');
    expect(t.kind).toBe(20002);
    expect(t.content).toBe('two minutes left');
    expect(t.tags).toEqual([
      ['h', 'main'],
      ['type', 'message']
    ]);
    expect(typeof t.created_at).toBe('number');
    expect(buildCallBroadcastTemplate('main', 'return').content).toBe('');
    expect(() => buildCallBroadcastTemplate('main', /** @type {any} */ ('shout'))).toThrow();
  });

  it('subscribes to the kind on the parent', () => {
    expect(callBroadcastFilter('main')).toEqual({ kinds: [20002], '#h': ['main'] });
  });
});

describe('parseCallBroadcast', () => {
  it('reads a message, a countdown (seconds) and a return', () => {
    expect(
      parseCallBroadcast(
        event(
          [
            ['h', 'main'],
            ['type', 'message']
          ],
          'hi'
        )
      )
    ).toEqual({
      id: 'ev',
      pubkey: PK,
      parentId: 'main',
      type: 'message',
      content: 'hi',
      createdAt: 1700000000,
      seconds: null
    });
    expect(
      parseCallBroadcast(
        event(
          [
            ['h', 'main'],
            ['type', 'countdown']
          ],
          '120'
        )
      )?.seconds
    ).toBe(120);
    expect(
      parseCallBroadcast(
        event([
          ['h', 'main'],
          ['type', 'return']
        ])
      )?.type
    ).toBe('return');
  });

  it('drops anything that is not a well-formed broadcast', () => {
    expect(parseCallBroadcast(null)).toBeNull();
    expect(
      parseCallBroadcast({
        ...event([
          ['h', 'main'],
          ['type', 'message']
        ]),
        kind: 9
      })
    ).toBe(null);
    expect(parseCallBroadcast(event([['type', 'message']]))).toBeNull();
    expect(
      parseCallBroadcast(
        event([
          ['h', 'a'],
          ['h', 'b'],
          ['type', 'message']
        ])
      )
    ).toBeNull();
    expect(
      parseCallBroadcast(
        event([
          ['h', 'main'],
          ['type', 'shout']
        ])
      )
    ).toBeNull();
    expect(parseCallBroadcast(event([['h', 'main']]))).toBeNull();
    expect(
      parseCallBroadcast(
        event(
          [
            ['h', 'main'],
            ['type', 'countdown']
          ],
          'soon'
        )
      )
    ).toBeNull();
    expect(
      parseCallBroadcast(
        event(
          [
            ['h', 'main'],
            ['type', 'countdown']
          ],
          '-5'
        )
      )
    ).toBeNull();
    expect(
      parseCallBroadcast({
        ...event([
          ['h', 'main'],
          ['type', 'message']
        ]),
        pubkey: 'nope'
      })
    ).toBeNull();
  });
});

describe('countdownDue', () => {
  it('fires each mark once as the time drops to it', () => {
    expect(COUNTDOWN_MARKS).toEqual([300, 120, 60]);
    let sent = new Set();
    expect(countdownDue(400, sent).mark).toBeNull();
    ({ sent } = countdownDue(400, sent));
    let step = countdownDue(300, sent);
    expect(step.mark).toBe(300);
    sent = step.sent;
    expect(countdownDue(299, sent).mark).toBeNull();
    step = countdownDue(120, sent);
    expect(step.mark).toBe(120);
    sent = step.sent;
    step = countdownDue(59, sent);
    expect(step.mark).toBe(60);
    sent = step.sent;
    expect(countdownDue(10, sent).mark).toBeNull();
    expect(countdownDue(0, sent).mark).toBeNull();
  });

  it('a late start sends only the tightest mark due and skips the ones above it', () => {
    const step = countdownDue(90, new Set());
    expect(step.mark).toBe(120);
    expect([...step.sent].sort()).toEqual([120, 300].sort());
    expect(countdownDue(89, step.sent).mark).toBeNull();
    expect(countdownDue(59, step.sent).mark).toBe(60);
  });

  it('a moved deadline fires the marks again', () => {
    let { sent } = countdownDue(60, new Set());
    expect(sent.has(60)).toBe(true);
    ({ sent } = countdownDue(360, sent)); // +5 min
    expect(sent.size).toBe(0);
    expect(countdownDue(300, sent).mark).toBe(300);
  });
});
