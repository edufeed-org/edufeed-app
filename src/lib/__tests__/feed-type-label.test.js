/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { feedTypeLabel } from '$lib/helpers/feed-type-label.js';
import * as m from '$lib/paraglide/messages';

describe('feedTypeLabel', () => {
  // getFeedCardData returns typeKey 'publication' for kind 30040; its FeedCard
  // badge and list type chip need a label, not ''.
  it('labels scientific publications', () => {
    expect(feedTypeLabel('publication')).toBe(m.feed_badge_publication());
    expect(feedTypeLabel('publication')).not.toBe('');
  });

  it('returns an empty string for an unknown type', () => {
    expect(feedTypeLabel('nope')).toBe('');
  });
});
