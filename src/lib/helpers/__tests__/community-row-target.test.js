/** @vitest-environment node */
// Where a row of the phone Communities list lands, and whether it is "neu":
// 1. newest item newer than the last visit → that item's section (if offered)
// 2. else the remembered section (if offered)
// 3. else home. No last visit on this device → nothing is new.
import { describe, it, expect } from 'vitest';
import {
  communityRowIsNew,
  communityRowTarget,
  newestCommunityItem
} from '../community-row-target.js';

const tabs = ['home', 'chat', 'calendar', 'channels'];
/** @param {number} kind @param {number} created_at */
const item = (kind, created_at) => ({ kind, created_at, id: `${kind}-${created_at}` });

describe('newestCommunityItem', () => {
  it('returns the item with the highest created_at, null for none', () => {
    expect(newestCommunityItem([item(1, 5), item(2, 9), item(3, 7)])?.created_at).toBe(9);
    expect(newestCommunityItem([])).toBeNull();
  });
});

describe('communityRowTarget', () => {
  it('step 1: newest unread item wins when its section is offered', () => {
    expect(
      communityRowTarget({ newest: item(31923, 50), lastVisit: 10, remembered: 'chat', tabs })
    ).toBe('calendar');
  });

  it('skips step 1 for a section the community lacks or a kind without a section', () => {
    expect(
      communityRowTarget({ newest: item(39701, 50), lastVisit: 10, remembered: 'chat', tabs })
    ).toBe('chat');
    expect(
      communityRowTarget({ newest: item(1111, 50), lastVisit: 10, remembered: null, tabs })
    ).toBe('home');
  });

  it('step 2: an already-seen newest item falls through to the remembered section', () => {
    expect(
      communityRowTarget({ newest: item(31923, 5), lastVisit: 10, remembered: 'channels', tabs })
    ).toBe('channels');
    expect(
      communityRowTarget({ newest: item(31923, 5), lastVisit: 10, remembered: 'forum', tabs })
    ).toBe('home');
  });

  it('a remembered channels view is honoured even though getCommunityTabs never lists it', () => {
    // 'channels' is added by communityNavTabIds (sheet), not getCommunityTabs
    // (what the Communities list has); the layout falls back to home itself
    // when a community no longer offers channels.
    expect(
      communityRowTarget({
        newest: null,
        lastVisit: 10,
        remembered: 'channels',
        tabs: ['home', 'chat']
      })
    ).toBe('channels');
  });

  it('no last visit → nothing is new → remembered or home', () => {
    expect(
      communityRowTarget({ newest: item(31923, 50), lastVisit: null, remembered: null, tabs })
    ).toBe('home');
    expect(communityRowIsNew(item(31923, 50), null)).toBe(false);
    expect(communityRowIsNew(item(31923, 50), 10)).toBe(true);
    expect(communityRowIsNew(item(31923, 5), 10)).toBe(false);
    expect(communityRowIsNew(null, 10)).toBe(false);
  });
});
