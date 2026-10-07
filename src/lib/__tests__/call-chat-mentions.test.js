// @ts-nocheck
/** @vitest-environment node */
// Issue "Video-Call chat: @mentions of call participants": the pure half —
// candidates over the people in the room, the identities a draft still
// mentions, and the chips a received message renders.
import { describe, it, expect } from 'vitest';
import {
  EVERYONE,
  mentionCandidates,
  mentionsIn,
  withMentions,
  isMentioned
} from '$lib/groups/call-chat-mentions.js';

const A = 'a'.repeat(64) + ':1';
const B = 'b'.repeat(64) + ':1';
const PEOPLE = [
  { identity: A, name: 'Anna Lund', pubkey: 'a'.repeat(64) },
  { identity: B, name: 'Bea', pubkey: 'b'.repeat(64) }
];

describe('mentionCandidates', () => {
  it('lists everyone first on an empty query, then the participants', () => {
    const rows = mentionCandidates('', PEOPLE, { everyone: 'alle' });
    expect(rows.map((r) => r.key)).toEqual([EVERYONE, A, B]);
    expect(rows[0]).toMatchObject({ name: 'alle', pubkey: null });
    expect(rows[1]).toMatchObject({ name: 'Anna Lund', pubkey: 'a'.repeat(64) });
  });

  it('matches names case-insensitively on any word start, and "alle" / "all" for everyone', () => {
    expect(mentionCandidates('lu', PEOPLE, { everyone: 'alle' }).map((r) => r.key)).toEqual([A]);
    expect(mentionCandidates('BE', PEOPLE, { everyone: 'alle' }).map((r) => r.key)).toEqual([B]);
    expect(mentionCandidates('al', PEOPLE, { everyone: 'alle' }).map((r) => r.key)).toEqual([
      EVERYONE
    ]);
    expect(mentionCandidates('all', PEOPLE, { everyone: 'everyone' }).map((r) => r.key)).toEqual([
      EVERYONE
    ]);
    expect(mentionCandidates('zzz', PEOPLE, { everyone: 'alle' })).toEqual([]);
  });

  it('caps the list at 8', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      identity: `${'c'.repeat(64)}:${i}`,
      name: `Person ${i}`,
      pubkey: 'c'.repeat(64)
    }));
    expect(mentionCandidates('', many, { everyone: 'alle' })).toHaveLength(8);
  });
});

describe('mentionsIn', () => {
  const picked = { Bea: B, 'Anna Lund': A, alle: EVERYONE };

  it('returns the identities whose @Name is still in the text, once each', () => {
    expect(mentionsIn('@Bea und @Anna Lund, @Bea nochmal', picked)).toEqual([B, A]);
  });

  it('returns "*" for @alle and nothing for names that were removed again', () => {
    expect(mentionsIn('@alle los', picked)).toEqual([EVERYONE]);
    expect(mentionsIn('Bea ohne at', picked)).toEqual([]);
    expect(mentionsIn('email@Bea.de', picked)).toEqual([]);
  });
});

describe('withMentions', () => {
  const names = { [B]: 'Bea', [A]: 'Anna Lund', [EVERYONE]: 'alle' };

  it('splits @Name of mentioned identities out of text segments as chips', () => {
    expect(withMentions([{ text: 'hey @Bea und @Anna Lund!' }], [B, A], names)).toEqual([
      { text: 'hey ' },
      { mention: B, label: '@Bea' },
      { text: ' und ' },
      { mention: A, label: '@Anna Lund' },
      { text: '!' }
    ]);
  });

  it('leaves link segments and un-mentioned names alone, returns the input when there is nothing to do', () => {
    const link = { href: 'https://x.org/@Bea', label: 'x', internal: false };
    expect(withMentions([{ text: '@Bea @Carl' }, link], [B], names)).toEqual([
      { mention: B, label: '@Bea' },
      { text: ' @Carl' },
      link
    ]);
    const segs = [{ text: '@Bea' }];
    expect(withMentions(segs, undefined, names)).toBe(segs);
  });

  it("renders @alle as a chip for everyone, in any locale's spelling", () => {
    expect(withMentions([{ text: '@alle her' }], [EVERYONE], names)).toEqual([
      { mention: EVERYONE, label: '@alle' },
      { text: ' her' }
    ]);
    // an English receiver labels "*" "everyone" but the sender typed @alle
    expect(withMentions([{ text: '@alle her' }], [EVERYONE], { [EVERYONE]: 'everyone' })).toEqual([
      { mention: EVERYONE, label: '@alle' },
      { text: ' her' }
    ]);
  });
});

describe('isMentioned', () => {
  it('is true for my identity or for everyone, never for my own message', () => {
    expect(isMentioned({ identity: A, mentions: [B] }, B)).toBe(true);
    expect(isMentioned({ identity: A, mentions: [EVERYONE] }, B)).toBe(true);
    expect(isMentioned({ identity: A, mentions: [A] }, B)).toBe(false);
    expect(isMentioned({ identity: B, mentions: [EVERYONE] }, B)).toBe(false);
    expect(isMentioned({ identity: A }, B)).toBe(false);
  });
});
