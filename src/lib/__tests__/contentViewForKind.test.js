/**
 * getContentViewForKind helper tests
 *
 * Maps a Nostr event kind to the community layout's content-view id
 * (used as ?view= and as sidebar selection). Returns undefined for kinds
 * that don't correspond to a sidebar tab so callers can leave the view
 * untouched.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { getContentViewForKind } from '../helpers/contentViewForKind.js';

describe('getContentViewForKind', () => {
  it('maps kind 11 (forum thread) to "forum"', () => {
    expect(getContentViewForKind(11)).toBe('forum');
  });

  it('maps kind 1 (text note) to "forum"', () => {
    // In community context the inline thread view renders kind 1 the same as
    // kind 11, so we keep the sidebar on the forum tab.
    expect(getContentViewForKind(1)).toBe('forum');
  });

  it('maps kind 1068 (poll) to "polls"', () => {
    expect(getContentViewForKind(1068)).toBe('polls');
  });

  it('returns undefined for kinds without a sidebar mapping', () => {
    expect(getContentViewForKind(7)).toBeUndefined(); // reaction
    expect(getContentViewForKind(1111)).toBeUndefined(); // comment (root is resolved separately)
    expect(getContentViewForKind(30142)).toBeUndefined(); // AMB resource (has dedicated route)
    expect(getContentViewForKind(undefined)).toBeUndefined();
    expect(getContentViewForKind(null)).toBeUndefined();
  });
});
