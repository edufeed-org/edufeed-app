/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { runningCalls, upcomingMeetings } from '$lib/groups/my-calls.js';

const RELAY = 'wss://groups.example/';
const A = { id: 'chanA', relay: RELAY };
const B = { id: 'chanB', relay: 'wss://Groups.example' }; // same relay, other spelling
const ME = 'a'.repeat(64);
const NOW = 1_000_000;

/** @param {Partial<{id: string, pubkey: string, created_at: number, d: string, h: string[], start: number, end: number, title: string}>} o */
const meeting = (o = {}) => ({
  kind: 31923,
  id: o.id ?? 'id-' + (o.d ?? 'm1'),
  pubkey: o.pubkey ?? ME,
  created_at: o.created_at ?? NOW - 500,
  tags: [
    ['d', o.d ?? 'm1'],
    ['title', o.title ?? 'Planung'],
    ['start', String(o.start ?? NOW + 3600)],
    ...(o.end ? [['end', String(o.end)]] : []),
    ...(o.h ?? ['chanA']).map((h) => ['h', h])
  ]
});

describe('runningCalls', () => {
  it('lists my channels with people in the call, fullest first', () => {
    const rows = runningCalls([A, B, { id: 'quiet', relay: RELAY }], {
      [`chanA@${RELAY}`]: ['p1'],
      [`chanB@${RELAY}`]: ['p1', 'p2'],
      [`quiet@${RELAY}`]: []
    });
    expect(rows.map((r) => [r.pointer.id, r.participants.length])).toEqual([
      ['chanB', 2],
      ['chanA', 1]
    ]);
  });

  it('is empty without presence data', () => {
    expect(runningCalls([A], {})).toEqual([]);
  });
});

describe('upcomingMeetings', () => {
  it('returns meetings that have not ended, earliest first, with their channel', () => {
    const rows = upcomingMeetings(
      [
        meeting({ d: 'later', start: NOW + 7200, title: 'Später' }),
        meeting({ d: 'soon', start: NOW + 60, h: ['chanB'], title: 'Gleich' }),
        meeting({ d: 'past', start: NOW - 9000, end: NOW - 10 }),
        meeting({ d: 'running', start: NOW - 60, end: NOW + 600, title: 'Läuft' })
      ],
      [A, B],
      NOW
    );
    expect(rows.map((r) => [r.title, r.pointer.id, r.started])).toEqual([
      ['Läuft', 'chanA', true],
      ['Gleich', 'chanB', false],
      ['Später', 'chanA', false]
    ]);
  });

  it('uses the newest version of a rescheduled meeting', () => {
    const rows = upcomingMeetings(
      [
        meeting({ id: 'v1', created_at: NOW - 900, start: NOW + 100 }),
        meeting({ id: 'v2', created_at: NOW - 100, start: NOW + 5000 })
      ],
      [A],
      NOW
    );
    expect(rows.map((r) => [r.event.id, r.start])).toEqual([['v2', NOW + 5000]]);
  });

  it('drops a meeting its author deleted, by address or by id, but not on a foreign or older kind 5', () => {
    const m1 = meeting({ d: 'm1' });
    const m2 = meeting({ d: 'm2', id: 'm2id' });
    const m3 = meeting({ d: 'm3' });
    const m4 = meeting({ d: 'm4' });
    const del = (/** @type {string[][]} */ tags, o = {}) => ({
      kind: 5,
      pubkey: ME,
      created_at: NOW - 10,
      tags,
      ...o
    });
    const rows = upcomingMeetings(
      [
        m1,
        m2,
        m3,
        m4,
        del([['a', `31923:${ME}:m1`]]),
        del([['e', 'm2id']]),
        del([['a', `31923:${ME}:m3`]], { pubkey: 'b'.repeat(64) }),
        del([['a', `31923:${ME}:m4`]], { created_at: NOW - 9999 })
      ],
      [A],
      NOW
    );
    expect(rows.map((r) => r.event.tags[0][1]).sort()).toEqual(['m3', 'm4']);
  });

  it('ignores meetings of channels that are not mine, with several h tags, or without a start', () => {
    const noStart = meeting({ d: 'x' });
    noStart.tags = noStart.tags.filter((t) => t[0] !== 'start');
    expect(
      upcomingMeetings(
        [meeting({ h: ['other'] }), meeting({ d: 'two', h: ['chanA', 'chanB'] }), noStart],
        [A, B],
        NOW
      )
    ).toEqual([]);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 8 }, (_, i) => meeting({ d: 'm' + i, start: NOW + 100 + i }));
    expect(upcomingMeetings(many, [A], NOW, 3)).toHaveLength(3);
  });
});
