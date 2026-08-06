/** @vitest-environment jsdom */
/**
 * CommunitySidebar — the rail as one arrangeable list.
 *
 * Asserts the WIRING, because the model has its own tests and a green model
 * proved nothing about the rail twice already: that the three sources really
 * become one ordered list, that a stored arrangement really reaches the DOM,
 * and that a drop really writes one back.
 *
 * The drag itself is driven through the real dragstart/dragover/drop events
 * the component listens for — a direct call to its handler would only re-state
 * the model's tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

const ME = 'f'.repeat(64);
const COMMUNITY_A = 'a'.repeat(64);
const COMMUNITY_B = 'b'.repeat(64);

const mockManager = vi.hoisted(() => ({ active: { pubkey: 'f'.repeat(64), signer: {} } }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  useActiveUser: () => () => mockManager.active
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { concord: { enabled: true } },
  configReady: { subscribe: () => () => {} }
}));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));

const holders = vi.hoisted(() => ({
  /** @type {string[]} */ communities: [],
  /** @type {any[]} */ areas: [],
  /** @type {any[]} */ groups: [],
  locked: false
}));

// The rail watches its own size for the scroll-edge fades; jsdom has no
// ResizeObserver, and without this every render throws before any assertion.
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useJoinedCommunitiesList: () => () => holders.communities
}));
vi.mock('$lib/concord/unlinked-areas.svelte.js', () => ({
  useUnlinkedConcordAreas: () => () => holders.areas,
  useConcordListLocked: () => () => holders.locked
}));
vi.mock('$lib/groups/unlinked-groups.svelte.js', () => ({
  useUnlinkedGroups: () => () => holders.groups
}));
vi.mock('$lib/concord/client.svelte.js', () => ({
  getConcordState: () => ({ phase: 'ready', client: { signer: {} }, unlocking: false }),
  unlockConcordLists: vi.fn()
}));
vi.mock('$lib/concord/notifications.svelte.js', () => ({
  areaUnreadState: () => ({ unread: false, mentioned: false })
}));
// The profile store opens a relay subscription per community; the rail only
// needs a name and a picture, and neither is what these tests are about.
vi.mock('$lib/stores/user-profile.svelte', () => ({ useUserProfile: () => () => null }));

import CommunitySidebar from '$lib/components/community/layout/CommunitySidebar.svelte';

/** The props every render here uses; none of them is what these tests measure. */
const PROPS = {
  currentCommunityId: '',
  onCommunitySelect: () => {},
  onHomeSelect: () => {}
};

beforeEach(() => {
  localStorage.clear();
  holders.communities = [COMMUNITY_A, COMMUNITY_B];
  holders.areas = [];
  holders.groups = [];
  holders.locked = false;
});

/** The rail's slots, in DOM order, by the anchor each one carries. */
function anchors() {
  return screen
    .getAllByTestId('rail-slot')
    .map((el) => el.getAttribute('data-rail-anchor'))
    .filter((a) => a !== null);
}

/**
 * Drive a real HTML5 drag from one slot to another. `ratio` is where inside
 * the target row the pointer sits — that is what dropIntent reads.
 * @param {string} from @param {string} to @param {number} ratio
 */
function drag(from, to, ratio) {
  // Looked up by reading the attribute rather than by selector: anchors carry
  // relay URLs with `/` and `:` in them, and jsdom has no CSS.escape.
  const slot = (/** @type {string} */ anchor) =>
    [...document.querySelectorAll('[data-rail-anchor]')].find(
      (el) => el.getAttribute('data-rail-anchor') === anchor
    );
  const source = slot(from);
  const target = slot(to);
  if (!source || !target) throw new Error(`no slot for ${!source ? from : to}`);
  // jsdom gives every element a zero-size box, so the height dropIntent needs
  // has to be supplied here — otherwise every drop would read as 'into'.
  target.getBoundingClientRect = () => /** @type {any} */ ({ top: 0, height: 48 });
  source.dispatchEvent(new Event('dragstart', { bubbles: true }));
  const over = new Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperty(over, 'clientY', { value: 48 * ratio });
  target.dispatchEvent(over);
  target.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
}

describe('CommunitySidebar — the arrangeable rail', () => {
  it('puts all three sources in one list, in the order the rail always had', () => {
    holders.areas = [{ communityId: 'area-1', name: 'Leitung' }];
    holders.groups = [
      { key: 'g@wss://r/', name: 'Allgemein', symbol: '#', pointer: { id: 'g', relay: 'wss://r' } }
    ];
    render(CommunitySidebar, { props: PROPS });
    expect(anchors()).toEqual([
      `community:${COMMUNITY_A}`,
      `community:${COMMUNITY_B}`,
      'area:area-1',
      'group:g@wss://r/'
    ]);
  });

  it('draws the stored arrangement, not the discovery order', () => {
    localStorage.setItem(
      `rail-layout:${ME}`,
      JSON.stringify([{ type: 'item', key: `community:${COMMUNITY_B}` }])
    );
    render(CommunitySidebar, { props: PROPS });
    expect(anchors()).toEqual([`community:${COMMUNITY_B}`, `community:${COMMUNITY_A}`]);
  });

  // The whole gesture, end to end: dropping on a row's top edge reorders.
  it('writes a new order when one icon is dropped above another', () => {
    render(CommunitySidebar, { props: PROPS });
    drag(`community:${COMMUNITY_B}`, `community:${COMMUNITY_A}`, 0.1);
    expect(JSON.parse(localStorage.getItem(`rail-layout:${ME}`) ?? '[]')).toEqual([
      { type: 'item', key: `community:${COMMUNITY_B}` },
      { type: 'item', key: `community:${COMMUNITY_A}` }
    ]);
  });

  it('folds two icons into a folder when one is dropped onto the middle of the other', async () => {
    render(CommunitySidebar, { props: PROPS });
    drag(`community:${COMMUNITY_B}`, `community:${COMMUNITY_A}`, 0.5);
    const stored = JSON.parse(localStorage.getItem(`rail-layout:${ME}`) ?? '[]');
    expect(stored).toEqual([
      {
        type: 'folder',
        id: 'f1',
        name: expect.any(String),
        keys: [`community:${COMMUNITY_A}`, `community:${COMMUNITY_B}`]
      }
    ]);
    // Not just written — PAINTED. The store is localStorage plus a reactive
    // version counter, and a write that does not reach the DOM would leave the
    // rail showing the old arrangement until reload.
    await tick();
    expect(screen.getByTestId('rail-folder-tile')).toBeTruthy();
    expect(anchors()).toEqual(['folder:f1']);
  });

  // A closed folder must not also show its members loose in the rail — that is
  // the same room twice, the exact duplication the unlinked rules exist for.
  it('hides a folder members until it is opened', () => {
    localStorage.setItem(
      `rail-layout:${ME}`,
      JSON.stringify([
        { type: 'folder', id: 'f1', name: 'Schule', keys: [`community:${COMMUNITY_A}`] },
        { type: 'item', key: `community:${COMMUNITY_B}` }
      ])
    );
    render(CommunitySidebar, { props: PROPS });
    expect(anchors()).toEqual(['folder:f1', `community:${COMMUNITY_B}`]);
  });

  it('shows a folder members once it is open, and remembers that it is', () => {
    localStorage.setItem(
      `rail-layout:${ME}`,
      JSON.stringify([
        { type: 'folder', id: 'f1', name: 'Schule', keys: [`community:${COMMUNITY_A}`] },
        { type: 'item', key: `community:${COMMUNITY_B}` }
      ])
    );
    localStorage.setItem(`rail-open-folders:${ME}`, JSON.stringify(['f1']));
    render(CommunitySidebar, { props: PROPS });
    expect(anchors()).toEqual([
      'folder:f1',
      `community:${COMMUNITY_A}`,
      `community:${COMMUNITY_B}`
    ]);
  });

  // Open/closed is per device and must stay OUT of the arrangement, or a
  // second device would inherit which folders someone had expanded.
  it('keeps the open set out of the stored arrangement', () => {
    localStorage.setItem(
      `rail-layout:${ME}`,
      JSON.stringify([
        { type: 'folder', id: 'f1', name: 'Schule', keys: [`community:${COMMUNITY_A}`] }
      ])
    );
    render(CommunitySidebar, { props: PROPS });
    screen.getByTestId('rail-folder-tile').click();
    expect(JSON.parse(localStorage.getItem(`rail-open-folders:${ME}`) ?? '[]')).toEqual(['f1']);
    expect(JSON.parse(localStorage.getItem(`rail-layout:${ME}`) ?? '[]')).toEqual([
      { type: 'folder', id: 'f1', name: 'Schule', keys: [`community:${COMMUNITY_A}`] }
    ]);
  });

  it('stores nothing for a drop that would lose the entry', () => {
    render(CommunitySidebar, { props: PROPS });
    drag(`community:${COMMUNITY_A}`, `community:${COMMUNITY_A}`, 0.5);
    expect(localStorage.getItem(`rail-layout:${ME}`)).toBeNull();
  });

  // The unlock tool is an action, not a container: it must not become a
  // draggable slot, or it could be filed into a folder.
  it('leaves the unlock affordance out of the arrangeable list', () => {
    holders.locked = true;
    render(CommunitySidebar, { props: PROPS });
    // Present — otherwise this would pass on a rail that simply never renders
    // it — but not a slot, so it can never be dragged into a folder.
    expect(screen.getAllByTestId('concord_unlock_areas').length).toBeGreaterThan(0);
    expect(anchors()).toEqual([`community:${COMMUNITY_A}`, `community:${COMMUNITY_B}`]);
  });
});
