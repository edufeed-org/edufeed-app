/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import { calendarFilters } from '../stores/calendar-filters.svelte.js';

describe('calendarFilters — onlyFollowsMode + getEffectiveAuthorPubkeys()', () => {
  beforeEach(() => {
    calendarFilters.reset();
  });

  it('starts with onlyFollowsMode = "off"', () => {
    expect(calendarFilters.onlyFollowsMode).toBe('off');
  });

  it('returns [] when no people-related filters are active', () => {
    expect(calendarFilters.getEffectiveAuthorPubkeys()).toEqual([]);
  });

  it('returns userFollowPubkeys when mode = "follows"', () => {
    calendarFilters.setUserFollowPubkeys(['a', 'b', 'c']);
    calendarFilters.setOnlyFollowsMode('follows');
    expect([...calendarFilters.getEffectiveAuthorPubkeys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('returns featuredAuthorPubkeys when mode = "featured"', () => {
    calendarFilters.setFeaturedAuthorPubkeys(['x', 'y']);
    calendarFilters.setOnlyFollowsMode('featured');
    expect([...calendarFilters.getEffectiveAuthorPubkeys()].sort()).toEqual(['x', 'y']);
  });

  it('does not use the other pool when mode is set to one specifically', () => {
    calendarFilters.setUserFollowPubkeys(['a']);
    calendarFilters.setFeaturedAuthorPubkeys(['x']);
    calendarFilters.setOnlyFollowsMode('follows');
    expect(calendarFilters.getEffectiveAuthorPubkeys()).toEqual(['a']);
  });

  it('unions toggle pool with NIP-51 list authors', () => {
    calendarFilters.setUserFollowPubkeys(['a', 'b']);
    calendarFilters.setFollowLists([
      { id: 'L1', name: 'L1', type: 'nip51', pubkeys: ['c', 'd'], count: 2 }
    ]);
    calendarFilters.setSelectedFollowListIds(['L1']);
    calendarFilters.setOnlyFollowsMode('follows');
    expect([...calendarFilters.getEffectiveAuthorPubkeys()].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('unions toggle pool with individually-picked authors (selectedFeaturedAuthors)', () => {
    calendarFilters.setUserFollowPubkeys(['a']);
    calendarFilters.setSelectedFeaturedAuthors(['z']);
    calendarFilters.setOnlyFollowsMode('follows');
    expect([...calendarFilters.getEffectiveAuthorPubkeys()].sort()).toEqual(['a', 'z']);
  });

  it('deduplicates across all sources', () => {
    calendarFilters.setUserFollowPubkeys(['a', 'b']);
    calendarFilters.setFollowLists([
      { id: 'L1', name: 'L1', type: 'nip51', pubkeys: ['b', 'c'], count: 2 }
    ]);
    calendarFilters.setSelectedFollowListIds(['L1']);
    calendarFilters.setSelectedFeaturedAuthors(['c', 'd']);
    calendarFilters.setOnlyFollowsMode('follows');
    expect([...calendarFilters.getEffectiveAuthorPubkeys()].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('returns only individual + list picks when mode = "off"', () => {
    calendarFilters.setUserFollowPubkeys(['a', 'b']);
    calendarFilters.setSelectedFeaturedAuthors(['z']);
    calendarFilters.setOnlyFollowsMode('off');
    expect(calendarFilters.getEffectiveAuthorPubkeys()).toEqual(['z']);
  });

  it('reset() returns mode and pools to defaults', () => {
    calendarFilters.setUserFollowPubkeys(['a']);
    calendarFilters.setFeaturedAuthorPubkeys(['x']);
    calendarFilters.setOnlyFollowsMode('follows');
    calendarFilters.reset();
    expect(calendarFilters.onlyFollowsMode).toBe('off');
    expect(calendarFilters.userFollowPubkeys).toEqual([]);
    expect(calendarFilters.featuredAuthorPubkeys).toEqual([]);
  });
});
