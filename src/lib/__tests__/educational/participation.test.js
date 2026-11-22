/** @vitest-environment node */
/**
 * "Beteiligt an": a profile is a participant of an AMB resource (kind 30142)
 * when the event carries a `["p", <pubkey>, <relay>, "creator"|"contributor"]`
 * tag for it (NIP-AMB AMB.md l.26). A missing marker counts as creator
 * (legacy events written before markers); any other marker is a mention.
 */
import { describe, it, expect } from 'vitest';
import {
  getParticipationRole,
  withParticipationCounts,
  participationFilter
} from '$lib/helpers/educational/participation.js';

const PK = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

/** @param {string[][]} tags */
const ev = (tags, pubkey = OTHER) => ({ kind: 30142, pubkey, tags, content: '', id: 'x' });

describe('getParticipationRole', () => {
  it('returns creator for a creator-marked p tag', () => {
    expect(getParticipationRole(ev([['p', PK, 'wss://r', 'creator']]), PK)).toBe('creator');
  });

  it('returns contributor for a contributor-marked p tag', () => {
    expect(getParticipationRole(ev([['p', PK, '', 'contributor']]), PK)).toBe('contributor');
  });

  it('treats an unmarked p tag as creator (legacy events)', () => {
    expect(getParticipationRole(ev([['p', PK]]), PK)).toBe('creator');
  });

  it('ignores other markers (mentions) and other pubkeys', () => {
    expect(getParticipationRole(ev([['p', PK, '', 'mention']]), PK)).toBeNull();
    expect(getParticipationRole(ev([['p', OTHER, '', 'creator']]), PK)).toBeNull();
  });

  it('matches the pubkey case-insensitively and rejects other kinds', () => {
    expect(getParticipationRole(ev([['p', PK.toUpperCase(), '', 'creator']]), PK)).toBe('creator');
    expect(getParticipationRole({ ...ev([['p', PK, '', 'creator']]), kind: 1 }, PK)).toBeNull();
  });

  it('articles (30023): marked credits count, an unmarked p tag is a body mention', () => {
    const article = (/** @type {string[][]} */ tags) => ({ ...ev(tags), kind: 30023 });
    expect(getParticipationRole(article([['p', PK, '', 'creator']]), PK)).toBe('creator');
    expect(getParticipationRole(article([['p', PK, '', 'contributor']]), PK)).toBe('contributor');
    expect(getParticipationRole(article([['p', PK]]), PK)).toBeNull();
  });
});

describe('participationFilter', () => {
  it('builds the #p filter for kind 30142', () => {
    expect(participationFilter(PK)).toEqual({ kinds: [30142], '#p': [PK] });
    expect(participationFilter(PK, 30023)).toEqual({ kinds: [30023], '#p': [PK] });
  });
});

// Empty profile tabs are hidden, so the tab counts must know about credited
// content: a profile that is only credited would show no tabs at all.
describe('withParticipationCounts', () => {
  const ME = 'a'.repeat(64);
  const OTHER = 'b'.repeat(64);
  const counts = { posts: 3, content: 1, articles: 0, wikis: 0 };

  it('adds credited resources and articles by others to their tabs', () => {
    const result = withParticipationCounts(
      counts,
      [
        { kind: 30142, pubkey: OTHER, tags: [['p', ME, '', 'creator']] },
        { kind: 30142, pubkey: OTHER, tags: [['p', ME]] },
        { kind: 30023, pubkey: OTHER, tags: [['p', ME, '', 'contributor']] }
      ],
      ME
    );
    expect(result).toEqual({ posts: 3, content: 3, articles: 1, wikis: 0 });
  });

  it('skips own events and plain mentions', () => {
    const result = withParticipationCounts(
      counts,
      [
        { kind: 30142, pubkey: ME, tags: [['p', ME, '', 'creator']] },
        { kind: 30023, pubkey: OTHER, tags: [['p', ME]] }
      ],
      ME
    );
    expect(result).toEqual(counts);
  });
});
