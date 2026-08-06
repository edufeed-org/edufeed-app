/** @vitest-environment jsdom */
/**
 * ContentNavSidebar — the channels tab for a community extended by NIP-29
 * groups.
 *
 * The rule itself is unit-tested (shouldShowChannelsTab). What only this test
 * can prove is that the sidebar actually asks it about THIS community's group
 * pointers — a gate that is passed the wrong input silently hides the whole
 * feature, and every pure test stays green.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);
const RELAY = 'wss://groups.example';

// Concord OFF in every way it can be off: flag, membership, pointer.
vi.mock('$lib/concord/community.svelte.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    useConcordCommunity: () => () => ({
      enabled: false,
      pointer: undefined,
      membership: 'none',
      community: undefined
    })
  };
});
vi.mock('$lib/concord/notifications.svelte.js', () => ({
  areaUnreadState: () => ({ unread: false, mentioned: false })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => ({ pubkey: 'b'.repeat(64) }) // a stranger, not the owner
}));

import ContentNavSidebar from '$lib/components/community/layout/ContentNavSidebar.svelte';

/** @param {string[][]} groupTags */
const communityEvent = (groupTags) => ({
  kind: 10222,
  pubkey: OWNER,
  content: '',
  tags: [['d', 'relilab'], ...groupTags]
});

/** @param {any} event */
function renderNav(event) {
  return render(ContentNavSidebar, {
    props: {
      selectedContentType: 'home',
      onContentTypeSelect: () => {},
      communityEvent: event
    }
  });
}

describe('ContentNavSidebar — channels tab from group pointers', () => {
  it('offers the channels tab to a stranger when the community lists group channels', () => {
    renderNav(communityEvent([['group', 'allgemein', RELAY]]));
    expect(screen.queryByTestId('content-nav-channels')).not.toBeNull();
  });

  it('does not offer it when the community has no protected area at all', () => {
    renderNav(communityEvent([]));
    expect(screen.queryByTestId('content-nav-channels')).toBeNull();
  });

  // An unaddressable pointer is not a channel — the tab would open on an
  // empty list.
  it('does not offer it for a group tag that carries no usable pointer', () => {
    renderNav(communityEvent([['group', 'allgemein', 'not a url']]));
    expect(screen.queryByTestId('content-nav-channels')).toBeNull();
  });
});
