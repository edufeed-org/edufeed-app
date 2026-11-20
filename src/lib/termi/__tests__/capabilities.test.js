/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { capabilityCards, pendingAnnouncement } from '../capabilities.js';

const ids = (/** @type {any[]} */ cards) =>
  cards.map((c) => (c.locked ? `${c.id}:${c.locked}` : c.id));

describe('capabilityCards', () => {
  it('shows nothing while the AI flag is off (the canned Termi keeps its chips)', () => {
    expect(capabilityCards({ ai: false, llm: true, loggedIn: true, eligible: true })).toEqual([]);
  });

  it('offers only the search when the deployment has no model', () => {
    expect(ids(capabilityCards({ ai: true, llm: false, loggedIn: true, eligible: true }))).toEqual([
      'material'
    ]);
  });

  it('offers all three to an eligible account', () => {
    expect(ids(capabilityCards({ ai: true, llm: true, loggedIn: true, eligible: true }))).toEqual([
      'material',
      'lesson',
      'import'
    ]);
  });

  it('tells a signed-in account without an address what is needed', () => {
    expect(ids(capabilityCards({ ai: true, llm: true, loggedIn: true, eligible: false }))).toEqual([
      'material',
      'more:address'
    ]);
  });

  it('tells an anonymous visitor to sign in', () => {
    expect(
      ids(capabilityCards({ ai: true, llm: true, loggedIn: false, eligible: undefined }))
    ).toEqual(['material', 'more:login']);
  });

  it('promises nothing while eligibility is still unknown', () => {
    expect(
      ids(capabilityCards({ ai: true, llm: true, loggedIn: true, eligible: undefined }))
    ).toEqual(['material']);
  });
});

describe('pendingAnnouncement', () => {
  const list = [
    { id: 'a', when: () => true },
    { id: 'b', when: () => false },
    { id: 'c', when: () => true }
  ];

  it('returns the first unseen announcement that applies', () => {
    expect(pendingAnnouncement(list, [], {})?.id).toBe('a');
    expect(pendingAnnouncement(list, ['a'], {})?.id).toBe('c');
  });

  it('returns nothing when all are seen or do not apply', () => {
    expect(pendingAnnouncement(list, ['a', 'c'], {})).toBeUndefined();
  });
});
