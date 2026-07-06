/**
 * SignupCommunityPicker — step 3 community selection in the signup wizard.
 *
 * Tests cover:
 *   - Suggested communities (config-derived) render pre-checked.
 *   - Empty search query renders a browse list of non-suggested communities (cap 12, by recency).
 *   - Browse list excludes suggested communities.
 *   - Typing in search hides the browse heading and shows search results.
 *   - Search matches by profile name.
 *   - Search matches by profile about.
 *   - Toggling a row updates the bound `selected` SvelteSet.
 *   - Search-discovered rows are unchecked by default.
 *   - "Other" search results are capped at 20.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { SvelteSet } from 'svelte/reactivity';

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'auth_signup_modal_step3_subtitle',
      'auth_signup_modal_step3_suggested_heading',
      'auth_signup_modal_step3_browse_heading',
      'auth_signup_modal_step3_search_placeholder',
      'auth_signup_modal_step3_no_matches'
    ].map((k) => [k, () => k])
  )
);

const mockConfig = vi.hoisted(() => ({
  runtimeConfig: { signup: { suggestedCommunities: /** @type {string[]} */ ([]) } }
}));
vi.mock('$lib/stores/config.svelte.js', () => mockConfig);

const mockTimeline = vi.hoisted(() => vi.fn());
const mockEventStore = vi.hoisted(() => ({
  // Picker calls eventStore.model(TimelineModel, filter); we don't need to
  // distinguish models here, so route everything through the same fixture fn.
  /**
   * @param {any} _model
   * @param {any[]} args
   */
  model: (_model, ...args) => mockTimeline(...args)
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore: mockEventStore }));
vi.mock('applesauce-core/models', () => ({
  TimelineModel: vi.fn()
}));

const mockProfileMap = vi.hoisted(() => new Map());
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => mockProfileMap
}));

// Hex pubkeys for fixtures (32 bytes = 64 hex).
const PK_SUGGESTED_1 = 'a'.repeat(64);
const PK_SUGGESTED_2 = 'b'.repeat(64);
const PK_OTHER_1 = 'c'.repeat(64);
const PK_OTHER_2 = 'd'.repeat(64);

/**
 * @param {string} pk
 * @param {number} [createdAt]
 */
function communityEvent(pk, createdAt = 0) {
  return {
    id: pk + '-id',
    kind: 10222,
    pubkey: pk,
    tags: [],
    content: '',
    created_at: createdAt,
    sig: ''
  };
}

/** @param {any[]} events */
function makeTimelineSubscribe(events) {
  return {
    /** @param {(events: any[]) => void} cb */
    subscribe: (cb) => {
      cb(events);
      return { unsubscribe: vi.fn() };
    }
  };
}

beforeEach(() => {
  mockConfig.runtimeConfig.signup.suggestedCommunities = [];
  mockTimeline.mockReset();
  mockProfileMap.clear();
});

import SignupCommunityPicker from '../SignupCommunityPicker.svelte';

describe('SignupCommunityPicker', () => {
  it('renders configured suggested communities pre-checked', async () => {
    mockConfig.runtimeConfig.signup.suggestedCommunities = [PK_SUGGESTED_1, PK_SUGGESTED_2];
    mockProfileMap.set(PK_SUGGESTED_1, { name: 'Alpha' });
    mockProfileMap.set(PK_SUGGESTED_2, { name: 'Beta' });
    mockTimeline.mockReturnValue(
      makeTimelineSubscribe([communityEvent(PK_SUGGESTED_1), communityEvent(PK_SUGGESTED_2)])
    );

    const selected = new SvelteSet([PK_SUGGESTED_1, PK_SUGGESTED_2]); // parent seeds
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    const rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(2);
    const checkboxes = container.querySelectorAll('[data-testid="signup-community-checkbox"]');
    checkboxes.forEach((cb) => expect(/** @type {HTMLInputElement} */ (cb).checked).toBe(true));
  });

  it('renders a browse list of non-suggested communities when search is empty', async () => {
    mockConfig.runtimeConfig.signup.suggestedCommunities = [PK_SUGGESTED_1];
    mockProfileMap.set(PK_SUGGESTED_1, { name: 'Alpha' });
    mockProfileMap.set(PK_OTHER_1, { name: 'Charlie' });
    mockProfileMap.set(PK_OTHER_2, { name: 'Delta' });
    mockTimeline.mockReturnValue(
      makeTimelineSubscribe([
        communityEvent(PK_SUGGESTED_1),
        communityEvent(PK_OTHER_1),
        communityEvent(PK_OTHER_2)
      ])
    );

    const selected = new SvelteSet([PK_SUGGESTED_1]);
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    // 1 suggested row + 2 browse rows
    const rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(3);
    // Browse heading is shown
    expect(container.textContent).toContain('auth_signup_modal_step3_browse_heading');
  });

  it('caps browse list at 12 and orders by created_at desc', async () => {
    const events = [];
    for (let i = 0; i < 20; i++) {
      const pk = i.toString(16).padStart(64, '0');
      events.push(communityEvent(pk, i)); // newer i ⇒ newer created_at
      mockProfileMap.set(pk, { name: `community-${i}` });
    }
    mockTimeline.mockReturnValue(makeTimelineSubscribe(events));

    const selected = new SvelteSet();
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    const rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(12);
    // First row should be the newest (i=19), last should be i=8 (12 newest)
    expect(rows[0].textContent).toContain('community-19');
    expect(rows[11].textContent).toContain('community-8');
  });

  it('browse list excludes suggested communities', async () => {
    mockConfig.runtimeConfig.signup.suggestedCommunities = [PK_SUGGESTED_1, PK_SUGGESTED_2];
    mockProfileMap.set(PK_SUGGESTED_1, { name: 'Alpha' });
    mockProfileMap.set(PK_SUGGESTED_2, { name: 'Beta' });
    mockProfileMap.set(PK_OTHER_1, { name: 'Charlie' });
    mockTimeline.mockReturnValue(
      makeTimelineSubscribe([
        communityEvent(PK_SUGGESTED_1),
        communityEvent(PK_SUGGESTED_2),
        communityEvent(PK_OTHER_1)
      ])
    );

    const selected = new SvelteSet([PK_SUGGESTED_1, PK_SUGGESTED_2]);
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    // 2 suggested + 1 in browse (Charlie); Alpha/Beta should not duplicate in browse
    const rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(3);
  });

  it('typing in search hides the browse heading', async () => {
    mockProfileMap.set(PK_OTHER_1, { name: 'Charlie' });
    mockProfileMap.set(PK_OTHER_2, { name: 'Delta' });
    mockTimeline.mockReturnValue(
      makeTimelineSubscribe([communityEvent(PK_OTHER_1), communityEvent(PK_OTHER_2)])
    );

    const selected = new SvelteSet();
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    // Initially the browse heading is visible
    expect(container.textContent).toContain('auth_signup_modal_step3_browse_heading');

    const search = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="signup-community-search"]')
    );
    await fireEvent.input(search, { target: { value: 'char' } });

    // Browse heading should be gone; search results active
    expect(container.textContent).not.toContain('auth_signup_modal_step3_browse_heading');
    const rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Charlie');
  });

  it('filters other communities by profile name', async () => {
    mockProfileMap.set(PK_OTHER_1, { name: 'Charlie' });
    mockProfileMap.set(PK_OTHER_2, { name: 'Delta' });
    mockTimeline.mockReturnValue(
      makeTimelineSubscribe([communityEvent(PK_OTHER_1), communityEvent(PK_OTHER_2)])
    );

    const selected = new SvelteSet();
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    const search = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="signup-community-search"]')
    );
    await fireEvent.input(search, { target: { value: 'char' } });

    const rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Charlie');
  });

  it('matches names across hyphens and other punctuation', async () => {
    // "e-teaching" should match query "etea" — separators are ignored on both sides.
    mockProfileMap.set(PK_OTHER_1, { name: 'e-teaching' });
    mockProfileMap.set(PK_OTHER_2, { name: 'Astronomy.Club' });
    mockTimeline.mockReturnValue(
      makeTimelineSubscribe([communityEvent(PK_OTHER_1), communityEvent(PK_OTHER_2)])
    );

    const selected = new SvelteSet();
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    const search = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="signup-community-search"]')
    );

    await fireEvent.input(search, { target: { value: 'etea' } });
    let rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('e-teaching');

    await fireEvent.input(search, { target: { value: 'astronomyclub' } });
    rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Astronomy.Club');
  });

  it('filters other communities by profile about', async () => {
    mockProfileMap.set(PK_OTHER_1, { name: 'Charlie', about: 'Pottery enthusiasts' });
    mockProfileMap.set(PK_OTHER_2, { name: 'Delta', about: 'Astronomy club' });
    mockTimeline.mockReturnValue(
      makeTimelineSubscribe([communityEvent(PK_OTHER_1), communityEvent(PK_OTHER_2)])
    );

    const selected = new SvelteSet();
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    const search = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="signup-community-search"]')
    );
    await fireEvent.input(search, { target: { value: 'astron' } });

    const rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Delta');
  });

  it('toggling a row updates the bound selected set', async () => {
    mockConfig.runtimeConfig.signup.suggestedCommunities = [PK_SUGGESTED_1];
    mockProfileMap.set(PK_SUGGESTED_1, { name: 'Alpha' });
    mockTimeline.mockReturnValue(makeTimelineSubscribe([communityEvent(PK_SUGGESTED_1)]));

    const selected = new SvelteSet([PK_SUGGESTED_1]);
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    const checkbox = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="signup-community-checkbox"]')
    );
    await fireEvent.click(checkbox);
    expect(selected.has(PK_SUGGESTED_1)).toBe(false);

    await fireEvent.click(checkbox);
    expect(selected.has(PK_SUGGESTED_1)).toBe(true);
  });

  it('search-discovered rows are unchecked by default', async () => {
    mockProfileMap.set(PK_OTHER_1, { name: 'Charlie' });
    mockTimeline.mockReturnValue(makeTimelineSubscribe([communityEvent(PK_OTHER_1)]));

    const selected = new SvelteSet();
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    const search = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="signup-community-search"]')
    );
    await fireEvent.input(search, { target: { value: 'char' } });

    const checkbox = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="signup-community-checkbox"]')
    );
    expect(checkbox.checked).toBe(false);
  });

  it('browse list hides communities without a profile name', async () => {
    mockProfileMap.set(PK_OTHER_1, { name: 'Charlie' });
    // PK_OTHER_2 has no profile at all → nameless, must not render as hex
    mockTimeline.mockReturnValue(
      makeTimelineSubscribe([communityEvent(PK_OTHER_1, 2), communityEvent(PK_OTHER_2, 1)])
    );

    const selected = new SvelteSet();
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    const rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Charlie');
    expect(container.textContent).not.toContain(PK_OTHER_2.slice(0, 16));
  });

  it('search results hide communities whose about matches but that have no name', async () => {
    mockProfileMap.set(PK_OTHER_1, { name: 'Charlie', about: 'pottery lovers' });
    mockProfileMap.set(PK_OTHER_2, { about: 'pottery too, but nameless' });
    mockTimeline.mockReturnValue(
      makeTimelineSubscribe([communityEvent(PK_OTHER_1), communityEvent(PK_OTHER_2)])
    );

    const selected = new SvelteSet();
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    const search = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="signup-community-search"]')
    );
    await fireEvent.input(search, { target: { value: 'pottery' } });

    const rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Charlie');
  });

  it('caps "other" results at 20', async () => {
    const events = [];
    for (let i = 0; i < 30; i++) {
      const pk = i.toString(16).padStart(64, '0');
      events.push(communityEvent(pk));
      mockProfileMap.set(pk, { name: `match-${i}`, about: 'pottery' });
    }
    mockTimeline.mockReturnValue(makeTimelineSubscribe(events));

    const selected = new SvelteSet();
    const { container } = render(SignupCommunityPicker, { props: { selected } });

    const search = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="signup-community-search"]')
    );
    await fireEvent.input(search, { target: { value: 'pottery' } });

    const rows = container.querySelectorAll('[data-testid="signup-community-row"]');
    expect(rows.length).toBe(20);
  });
});
