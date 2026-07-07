// @ts-nocheck
/**
 * Impersonation Matching Tests
 *
 * Tests for the impersonation-warning helpers:
 * - normalizeProfileName: canonical form for name comparison
 * - isSimilarName: fuzzy equality between profile names
 * - rankImpersonationCandidates: kind-0 search results → verified-match candidates
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeProfileName,
  isSimilarName,
  rankImpersonationCandidates
} from '$lib/helpers/impersonation.js';

function kind0(pubkey, content, created_at = 100) {
  return { kind: 0, pubkey, created_at, content: JSON.stringify(content), tags: [] };
}

const TARGET = 'f'.repeat(64);
const OTHER_A = 'a'.repeat(64);
const OTHER_B = 'b'.repeat(64);

describe('normalizeProfileName', () => {
  it('lowercases and trims', () => {
    expect(normalizeProfileName('  Musterfrau ')).toBe('musterfrau');
  });

  it('strips diacritics', () => {
    expect(normalizeProfileName('Jörg Müller')).toBe('jorg muller');
  });

  it('collapses whitespace and punctuation', () => {
    expect(normalizeProfileName('max_muster-mann  jr.')).toBe('max muster mann jr');
  });

  it('returns empty string for nullish input', () => {
    expect(normalizeProfileName(null)).toBe('');
    expect(normalizeProfileName(undefined)).toBe('');
  });
});

describe('isSimilarName', () => {
  it('matches normalized equality', () => {
    expect(isSimilarName('Musterfrau', 'musterfrau ')).toBe(true);
  });

  it('matches containment', () => {
    expect(isSimilarName('Musterfrau', 'Erika Musterfrau')).toBe(true);
    expect(isSimilarName('Erika Musterfrau', 'Musterfrau')).toBe(true);
  });

  it('rejects unrelated names', () => {
    expect(isSimilarName('Musterfrau', 'Beispielmann')).toBe(false);
  });

  it('rejects names shorter than 3 characters', () => {
    expect(isSimilarName('Jo', 'Jo')).toBe(false);
    expect(isSimilarName('Jo', 'Joachim')).toBe(false);
  });
});

describe('rankImpersonationCandidates', () => {
  it('returns similarly named profiles with a nip05', () => {
    const events = [
      kind0(OTHER_A, { name: 'Musterfrau', nip05: 'muster@relilab.org' }),
      kind0(OTHER_B, { name: 'Musterfrau', picture: 'x.png' }) // no nip05 → excluded
    ];
    const result = rankImpersonationCandidates(events, 'Musterfrau', TARGET);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ pubkey: OTHER_A, nip05: 'muster@relilab.org' });
  });

  it('excludes the target pubkey itself', () => {
    const events = [kind0(TARGET, { name: 'Musterfrau', nip05: 'muster@relilab.org' })];
    expect(rankImpersonationCandidates(events, 'Musterfrau', TARGET)).toHaveLength(0);
  });

  it('excludes dissimilar names', () => {
    const events = [kind0(OTHER_A, { name: 'Beispielmann', nip05: 'b@example.org' })];
    expect(rankImpersonationCandidates(events, 'Musterfrau', TARGET)).toHaveLength(0);
  });

  it('uses display_name as fallback name source', () => {
    const events = [kind0(OTHER_A, { display_name: 'Musterfrau', nip05: 'm@example.org' })];
    const result = rankImpersonationCandidates(events, 'Musterfrau', TARGET);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Musterfrau');
  });

  it('dedupes by pubkey keeping the newest event', () => {
    const events = [
      kind0(OTHER_A, { name: 'Musterfrau', nip05: 'old@example.org' }, 100),
      kind0(OTHER_A, { name: 'Musterfrau', nip05: 'new@example.org' }, 200)
    ];
    const result = rankImpersonationCandidates(events, 'Musterfrau', TARGET);
    expect(result).toHaveLength(1);
    expect(result[0].nip05).toBe('new@example.org');
  });

  it('caps the result list', () => {
    const events = Array.from({ length: 8 }, (_, i) =>
      kind0(String(i).repeat(64).slice(0, 64), { name: 'Musterfrau', nip05: `m${i}@x.org` })
    );
    expect(rankImpersonationCandidates(events, 'Musterfrau', TARGET, 3)).toHaveLength(3);
  });

  it('survives invalid JSON content', () => {
    const events = [{ kind: 0, pubkey: OTHER_A, created_at: 1, content: '{broken', tags: [] }];
    expect(rankImpersonationCandidates(events, 'Musterfrau', TARGET)).toHaveLength(0);
  });

  it('returns empty for empty target name', () => {
    const events = [kind0(OTHER_A, { name: 'Musterfrau', nip05: 'm@x.org' })];
    expect(rankImpersonationCandidates(events, '', TARGET)).toHaveLength(0);
  });
});
