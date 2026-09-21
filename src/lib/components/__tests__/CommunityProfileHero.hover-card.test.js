/**
 * CommunityProfileHero — profile hover card on the community name.
 *
 * A community IS an npub, so its name should behave like any other identity in
 * the app: hovering reveals the profile hover card, and the name itself links
 * to /p/<npub> so a click jumps straight there.
 *
 * The profile prop is the trap. In the `/c/[pubkey]` tree `profileEvent` is
 * ALREADY-PARSED profile content, while the same prop name carries a kind-0
 * event elsewhere — so the hero must normalise before handing it on, and these
 * tests cover both shapes.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

// jsdom has no Element.animate; Svelte transitions need one that settles.
if (!Element.prototype.animate) {
  Element.prototype.animate = /** @type {any} */ (
    function () {
      const finished = Promise.resolve();
      /** @type {any} */
      const anim = { onfinish: null, cancel: vi.fn(), finished, currentTime: null };
      finished.then(() => anim.onfinish && anim.onfinish());
      return anim;
    }
  );
}

vi.mock('$lib/paraglide/messages', () => ({
  communikey_header_join_button: () => 'Follow Community',
  communikey_header_joined_badge: () => 'Following',
  community_request_join: () => 'Apply to Join',
  community_members_count: (/** @type {{count: number}} */ { count }) => `${count} members`,
  community_members_count_one: () => '1 member',
  community_profile_hero_more: () => 'more',
  community_type_closed_title: () => 'Closed',
  community_hero_closed_hint: () => 'Invitation only',
  community_join_group: () => 'Join',
  community_join_request: () => 'Request to join',
  community_join_pending: () => 'Request sent',
  community_join_member: () => 'Member',
  community_join_invite_toggle: () => 'Redeem invite code',
  community_join_invite_placeholder: () => 'Code',
  community_join_invite_lead: () => 'Enter the invite code.',
  common_cancel: () => 'Cancel',
  community_join_invite_submit: () => 'Redeem',
  community_join_refused: () => 'Declined.',
  community_join_failed: () => 'Join failed'
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/stores', () => ({
  page: {
    subscribe: (/** @type {(value: any) => void} */ fn) => {
      fn({ url: new URL('http://localhost/c/test'), data: {} });
      return () => {};
    }
  }
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useCommunityMembership: () => () => false
}));
vi.mock('$lib/helpers/community', () => ({ joinCommunity: vi.fn() }));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => null }));
vi.mock('$lib/groups/root-roster.svelte.js', () => ({
  useRootRoster: () => () => ({
    pointer: null,
    refresh: vi.fn(),
    members: new Set(),
    admins: [],
    isLoading: false,
    isMember: () => false,
    rolesOf: () => []
  })
}));
vi.mock('$lib/groups/channel-metadata.svelte.js', () => ({
  useChannelMetadata: () => () => ({ byKey: {}, failedRelays: [] })
}));
vi.mock('$lib/groups/join-community-group.js', () => ({ joinCommunityGroup: vi.fn() }));
vi.mock('svelte', async (importOriginal) => {
  const actual = /** @type {Record<string, any>} */ (await importOriginal());
  return { ...actual, getContext: () => undefined };
});
vi.mock('$lib/components/shared/ProfileAvatar.svelte', () => ({ default: function Stub() {} }));
vi.mock('../../shared/ImageWithFallback.svelte', () => ({ default: function Stub() {} }));

// The card BODY has its own test; here we only prove the hero wires it up with
// the right pubkey and an already-parsed profile.
vi.mock('$lib/components/shared/ProfileHoverCardContent.svelte', async () => ({
  default: (await import('./fixtures/ProfileHoverCardContentStub.svelte')).default
}));

import CommunityProfileHero from '$lib/components/community/views/CommunityProfileHero.svelte';

// Must be real hex: profileLink() falls back to the raw string when
// hexToNpub fails, which would mask a genuinely broken link.
const COMMUNITY_PUBKEY = '5c090631223f8ead4c5b4b5091a072d321452db4116684b349b1b72ad37fffec';
const OPEN_EVENT = { kind: 10222, tags: [] };
// What `/c/[pubkey]` actually passes: ProfileModel output, already parsed.
const PARSED_PROFILE = { name: 'e-teaching.org', about: 'Hochschulbildung' };
// What the same prop name carries elsewhere: a raw kind-0 event.
const EVENT_PROFILE = { kind: 0, content: JSON.stringify(PARSED_PROFILE) };

function renderHero(/** @type {any} */ profileEvent) {
  return render(CommunityProfileHero, {
    props: {
      communityId: COMMUNITY_PUBKEY,
      communikeyEvent: OPEN_EVENT,
      profileEvent,
      onNavigateToAbout: vi.fn(),
      onMembersClick: vi.fn()
    }
  });
}

/** The hover-card trigger wrapping a given element. */
function triggerFor(/** @type {Element | null} */ el) {
  const trigger = el?.closest('[aria-haspopup]');
  expect(trigger).not.toBeNull();
  return /** @type {Element} */ (trigger);
}

/** Hover a trigger and let the enter delay elapse. */
async function hover(/** @type {Element} */ trigger) {
  await fireEvent.mouseEnter(trigger);
  vi.advanceTimersByTime(500);
  await tick();
}

/** Hover the community NAME. */
async function hoverName(/** @type {HTMLElement} */ container) {
  await hover(triggerFor(container.querySelector('h2')));
}

/** Hover the community AVATAR. */
async function hoverAvatar(/** @type {HTMLElement} */ container) {
  await hover(triggerFor(container.querySelector('[data-testid="hero-avatar"]')));
}

describe('CommunityProfileHero — profile hover card', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('links the community name to its profile page', () => {
    renderHero(PARSED_PROFILE);
    const link = screen.getByRole('link', { name: /e-teaching\.org/ });
    expect(link.getAttribute('href')).toContain('/p/npub1');
  });

  it('keeps the community name as a heading, not just a link', () => {
    renderHero(PARSED_PROFILE);
    const heading = screen.getByRole('heading', { name: /e-teaching\.org/ });
    expect(heading.querySelector('a')).not.toBeNull();
  });

  it('keeps the hover card hidden until the name is hovered', () => {
    renderHero(PARSED_PROFILE);
    expect(screen.queryByTestId('profile-hover-card')).toBeNull();
  });

  it('reveals the profile hover card for the community pubkey on hover', async () => {
    const { container } = renderHero(PARSED_PROFILE);
    await hoverName(container);

    const card = screen.getByTestId('profile-hover-card');
    expect(card.getAttribute('data-pubkey')).toBe(COMMUNITY_PUBKEY);
  });

  it('hands the card parsed content when given the /c parsed shape', async () => {
    const { container } = renderHero(PARSED_PROFILE);
    await hoverName(container);

    expect(screen.getByTestId('profile-hover-card').textContent?.trim()).toBe('e-teaching.org');
  });

  it('hands the card parsed content when given a kind-0 event instead', async () => {
    const { container } = renderHero(EVENT_PROFILE);
    await hoverName(container);

    expect(screen.getByTestId('profile-hover-card').textContent?.trim()).toBe('e-teaching.org');
  });

  it('links the avatar to the profile page too', () => {
    const { container } = renderHero(PARSED_PROFILE);
    const link = container.querySelector('[data-testid="hero-avatar"]')?.closest('a');
    expect(link?.getAttribute('href')).toContain('/p/npub1');
  });

  it('keeps the avatar link out of the tab order and the a11y tree', () => {
    // It duplicates the heading link's destination; announcing and tabbing to
    // the same profile twice is noise, so the name link is the real one.
    const { container } = renderHero(PARSED_PROFILE);
    const link = container.querySelector('[data-testid="hero-avatar"]')?.closest('a');
    expect(link?.getAttribute('aria-hidden')).toBe('true');
    expect(link?.getAttribute('tabindex')).toBe('-1');
  });

  it('reveals the same profile hover card from the avatar', async () => {
    const { container } = renderHero(PARSED_PROFILE);
    await hoverAvatar(container);

    const card = screen.getByTestId('profile-hover-card');
    expect(card.getAttribute('data-pubkey')).toBe(COMMUNITY_PUBKEY);
    expect(card.textContent?.trim()).toBe('e-teaching.org');
  });

  it('still renders the name when there is no profile at all', () => {
    renderHero(undefined);
    expect(screen.getByRole('link', { name: /Community/ })).toBeTruthy();
  });
});
