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

  it('matches the pubkey case-insensitively and rejects non-30142 events', () => {
    expect(getParticipationRole(ev([['p', PK.toUpperCase(), '', 'creator']]), PK)).toBe('creator');
    expect(getParticipationRole({ ...ev([['p', PK, '', 'creator']]), kind: 30023 }, PK)).toBeNull();
  });
});

describe('participationFilter', () => {
  it('builds the #p filter for kind 30142', () => {
    expect(participationFilter(PK)).toEqual({ kinds: [30142], '#p': [PK] });
  });
});
