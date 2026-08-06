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
      'relay:wss://r'
    ]);
  });

  // Grouping by host is what makes a ten-channel relay one container instead
  // of the one channel our own kind-10009 happened to name.
  it('gives a host with several channels ONE row', () => {
    holders.areas = [];
    holders.groups = [
      { key: 'a@wss://r/', name: 'Allgemein', symbol: '#', pointer: { id: 'a', relay: 'wss://r' } },
      {
        key: 'b@wss://r/',
        name: 'Leitung',
        symbol: '\u{1F512}',
        pointer: { id: 'b', relay: 'wss://r' }
      }
    ];
    render(CommunitySidebar, { props: PROPS });
    expect(anchors().filter((/** @type {string} */ a) => a.startsWith('relay:'))).toEqual([
      'relay:wss://r'
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
    // it — but not draggable and carrying no anchor, so it can neither be
    // moved nor filed into a folder. Found by mutation: asserting only on the
    // slot testid passed while the button carried a rail anchor.
    const buttons = screen.getAllByTestId('concord_unlock_areas');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute('draggable')).not.toBe('true');
      expect(button.closest('[data-rail-anchor]')).toBeNull();
    }
    expect(anchors()).toEqual([`community:${COMMUNITY_A}`, `community:${COMMUNITY_B}`]);
  });
});

/**
 * "You are here" for all three kinds of container.
 *
 * The rule itself is tested in rail-active.test.js; what these measure is the
 * WIRING — that the route really reaches every row the rail draws. The ring
 * existed for a community and for nothing else, so a Concord area and a NIP-29
 * host left the rail looking as if you were nowhere (laoc 2026-08-06).
 */
describe('CommunitySidebar — which container you are in', () => {
  const AREA = { communityId: 'area-1', name: 'Leitung' };
  const GROUP = {
    key: "a@wss://relay.example.com'a",
    name: 'Allgemein',
    symbol: '#',
    pointer: { id: 'a', relay: 'wss://relay.example.com' }
  };

  /** The anchors of every slot the rail marks as the one you are looking at. */
  function activeAnchors() {
    return [...document.querySelectorAll('[data-rail-anchor]')]
      .filter((el) => el.getAttribute('data-rail-active') === 'true')
      .map((el) => el.getAttribute('data-rail-anchor'));
  }

  it('marks the community the layout resolved', () => {
    render(CommunitySidebar, { props: { ...PROPS, currentCommunityId: COMMUNITY_B } });
    expect(activeAnchors()).toEqual([`community:${COMMUNITY_B}`]);
  });

  it('marks the host whose directory is open', () => {
    holders.groups = [GROUP];
    render(CommunitySidebar, {
      props: {
        ...PROPS,
        currentPath: `/relays/${encodeURIComponent('wss://relay.example.com')}`
      }
    });
    expect(activeAnchors()).toEqual(['relay:wss://relay.example.com']);
    // The slot's attribute is what these tests read, but the ICON is what a
    // reader sees — asserting only the attribute would pass on a rail that
    // marks the right row invisibly.
    expect(screen.getAllByTestId('sidebar-relay-icon')[0].getAttribute('aria-current')).toBe(
      'page'
    );
  });

  // Opening a channel from the host page leaves /relays — and the container
  // you are in has not changed, so neither may the rail.
  it('keeps the host marked while one of its channels is open', () => {
    holders.groups = [GROUP];
    render(CommunitySidebar, {
      props: {
        ...PROPS,
        currentPath: `/groups/${encodeURIComponent("wss://relay.example.com'a")}`
      }
    });
    expect(activeAnchors()).toEqual(['relay:wss://relay.example.com']);
  });

  it('marks the Concord area whose page is open', () => {
    holders.areas = [AREA];
    render(CommunitySidebar, { props: { ...PROPS, currentPath: '/private/area-1' } });
    expect(activeAnchors()).toEqual(['area:area-1']);
    expect(screen.getAllByTestId('rail-area-icon')[0].getAttribute('aria-current')).toBe('page');
  });

  // The Home button carries its own ring on the dashboard; a container marked
  // at the same time would claim you are in two places.
  it('marks nothing on the dashboard', () => {
    holders.areas = [AREA];
    render(CommunitySidebar, {
      props: {
        ...PROPS,
        currentCommunityId: COMMUNITY_A,
        currentPath: '/c',
        isDashboardActive: true
      }
    });
    expect(activeAnchors()).toEqual([]);
  });

  it('marks nothing on a route inside no container', () => {
    holders.groups = [GROUP];
    render(CommunitySidebar, { props: { ...PROPS, currentPath: '/discover' } });
    expect(activeAnchors()).toEqual([]);
  });

  // A closed folder hides its members, so without this the mark disappears
  // the moment someone files the container they use most into a folder.
  it('marks the folder that holds the container you are in', () => {
    localStorage.setItem(
      `rail-layout:${ME}`,
      JSON.stringify([
        { type: 'folder', id: 'f1', name: 'Schule', keys: [`community:${COMMUNITY_A}`] },
        { type: 'item', key: `community:${COMMUNITY_B}` }
      ])
    );
    render(CommunitySidebar, { props: { ...PROPS, currentCommunityId: COMMUNITY_A } });
    const tile = screen.getByTestId('rail-folder-tile');
    expect(tile.getAttribute('data-folder-active')).toBe('true');
  });

  it('leaves a folder unmarked when the container you are in is elsewhere', () => {
    localStorage.setItem(
      `rail-layout:${ME}`,
      JSON.stringify([
        { type: 'folder', id: 'f1', name: 'Schule', keys: [`community:${COMMUNITY_A}`] },
        { type: 'item', key: `community:${COMMUNITY_B}` }
      ])
    );
    render(CommunitySidebar, { props: { ...PROPS, currentCommunityId: COMMUNITY_B } });
    expect(screen.getByTestId('rail-folder-tile').getAttribute('data-folder-active')).toBe('false');
  });

  /**
   * Render with the marked row placed inside or outside the rail's own box.
   *
   * jsdom gives every element a zero-size rect, so without this the row and
   * the rail are the same empty box and the "already on screen" branch is the
   * only one that can ever run.
   * @param {{rowTop: number}} where
   * @returns {string[]} the anchors that were scrolled to
   */
  function renderWithGeometry({ rowTop }) {
    holders.groups = [GROUP];
    /** @type {string[]} */
    const scrolled = [];
    const originalScroll = Element.prototype.scrollIntoView;
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.scrollIntoView = function () {
      const anchor = /** @type {Element} */ (this).getAttribute('data-rail-anchor');
      if (anchor) scrolled.push(anchor);
    };
    Element.prototype.getBoundingClientRect = function () {
      const el = /** @type {Element} */ (this);
      if (el.getAttribute('data-testid') === 'community-sidebar')
        return /** @type {any} */ ({ top: 0, bottom: 100, height: 100 });
      if (el.getAttribute('data-rail-anchor'))
        return /** @type {any} */ ({ top: rowTop, bottom: rowTop + 48, height: 48 });
      return /** @type {any} */ ({ top: 0, bottom: 0, height: 0 });
    };
    try {
      render(CommunitySidebar, {
        props: {
          ...PROPS,
          currentPath: `/relays/${encodeURIComponent('wss://relay.example.com')}`
        }
      });
    } finally {
      Element.prototype.scrollIntoView = originalScroll;
      Element.prototype.getBoundingClientRect = originalRect;
    }
    return scrolled;
  }

  // The rail is taller than the screen for anyone with a dozen containers, so
  // the mark is worth nothing if the marked row is below the fold.
  it('scrolls the container you are in into view when it is below the fold', () => {
    expect(renderWithGeometry({ rowTop: 400 })).toContain('relay:wss://relay.example.com');
  });

  // …and only then: scrolling a rail that already shows the row would move it
  // under the reader's pointer for no reason.
  it('leaves the rail alone when that row is already on screen', () => {
    expect(renderWithGeometry({ rowTop: 20 })).toEqual([]);
  });
});
