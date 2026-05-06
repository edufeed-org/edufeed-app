// @ts-nocheck
/**
 * SuggestedFollowsBanner — non-blocking post-login nudge that lists
 * deployment-configured suggested users (`runtimeConfig.signup.suggestedUsers`,
 * an array of npubs). Lets the user pick a subset and publish a kind-3 contact
 * list. Hides forever once dismissed (per-pubkey localStorage flag).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';

const NPUB_1 = nip19.npubEncode(getPublicKey(generateSecretKey()));
const NPUB_2 = nip19.npubEncode(getPublicKey(generateSecretKey()));
const NPUB_3 = nip19.npubEncode(getPublicKey(generateSecretKey()));
const PUBKEY_1 = nip19.decode(NPUB_1).data;
const PUBKEY_2 = nip19.decode(NPUB_2).data;

const ACTIVE_PUBKEY = 'a'.repeat(64);

const mockActiveUser = vi.hoisted(() => ({ value: null }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockActiveUser.value
}));
vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => mockActiveUser.value
}));

function makeMockUser(pubkey) {
  return {
    type: 'nsec',
    pubkey,
    signer: {
      signEvent: vi.fn(async (e) => ({
        ...e,
        id: 'b'.repeat(64),
        sig: 'c'.repeat(128),
        pubkey
      }))
    }
  };
}

const mockConfig = vi.hoisted(() => ({
  runtimeConfig: { signup: { suggestedUsers: [] } }
}));
vi.mock('$lib/stores/config.svelte.js', () => mockConfig);

// useProfileMap fetches kind-0 events from the network in real life; in
// tests we just hand back an empty Map so the banner falls through to the
// truncated-npub fallback rendering.
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

const mockPublishEvent = vi.hoisted(() => vi.fn().mockResolvedValue({ success: true }));
vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: mockPublishEvent
}));

const mockEventStore = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: mockEventStore
}));

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'auth_follows_banner_title',
      'auth_follows_banner_body',
      'auth_follows_banner_follow_cta',
      'auth_follows_banner_dismiss',
      'common_loading'
    ].map((key) => [key, () => key])
  )
);

// Stub ProfileAvatar / shared bits so we don't pull profile loaders.
vi.mock('../shared/ProfileAvatar.svelte', async () => {
  const stub = await import('./__mocks__/EmptyStub.svelte');
  return { default: stub.default };
});

import SuggestedFollowsBanner from '../SuggestedFollowsBanner.svelte';

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockActiveUser.value = makeMockUser(ACTIVE_PUBKEY);
  mockConfig.runtimeConfig.signup.suggestedUsers = [];
  // Existing tests assume the user just signed up via the in-app wizard.
  // The dedicated "no flag" test below clears this in its own setup.
  localStorage.setItem(`signed-up-here:${ACTIVE_PUBKEY}`, '1');
});

describe('SuggestedFollowsBanner', () => {
  it('renders nothing when there is no active user', () => {
    mockActiveUser.value = null;
    mockConfig.runtimeConfig.signup.suggestedUsers = [NPUB_1];
    const { container } = render(SuggestedFollowsBanner);
    expect(container.querySelector('[data-testid="suggested-follows-banner"]')).toBeNull();
  });

  it('renders nothing when no suggested users are configured', () => {
    mockConfig.runtimeConfig.signup.suggestedUsers = [];
    const { container } = render(SuggestedFollowsBanner);
    expect(container.querySelector('[data-testid="suggested-follows-banner"]')).toBeNull();
  });

  it('renders one row per configured suggested user', () => {
    mockConfig.runtimeConfig.signup.suggestedUsers = [NPUB_1, NPUB_2, NPUB_3];
    const { container } = render(SuggestedFollowsBanner);
    const rows = container.querySelectorAll('[data-testid="suggested-follow-row"]');
    expect(rows.length).toBe(3);
  });

  it('does NOT render when the user did NOT sign up via the in-app wizard', () => {
    // Pre-existing user (extension import, paste-in nsec, returning session)
    // shouldn't see a one-shot follow nudge they already had a chance to dismiss.
    localStorage.removeItem(`signed-up-here:${ACTIVE_PUBKEY}`);
    mockConfig.runtimeConfig.signup.suggestedUsers = [NPUB_1];
    const { container } = render(SuggestedFollowsBanner);
    expect(container.querySelector('[data-testid="suggested-follows-banner"]')).toBeNull();
  });

  it('hides when `follows-banner-dismissed:<pubkey>` flag is set', () => {
    mockConfig.runtimeConfig.signup.suggestedUsers = [NPUB_1];
    localStorage.setItem(`follows-banner-dismissed:${ACTIVE_PUBKEY}`, '1');
    const { container } = render(SuggestedFollowsBanner);
    expect(container.querySelector('[data-testid="suggested-follows-banner"]')).toBeNull();
  });

  it('clicking dismiss persists the dismiss flag and hides the banner', async () => {
    mockConfig.runtimeConfig.signup.suggestedUsers = [NPUB_1];
    const { container } = render(SuggestedFollowsBanner);

    const dismissBtn = container.querySelector('[data-testid="follows-banner-dismiss"]');
    expect(dismissBtn).not.toBeNull();
    await fireEvent.click(/** @type {HTMLElement} */ (dismissBtn));

    expect(localStorage.getItem(`follows-banner-dismissed:${ACTIVE_PUBKEY}`)).toBe('1');
    expect(container.querySelector('[data-testid="suggested-follows-banner"]')).toBeNull();
  });

  it('publishes a kind-3 contact list with the checked pubkeys when "Follow selected" is clicked', async () => {
    mockConfig.runtimeConfig.signup.suggestedUsers = [NPUB_1, NPUB_2, NPUB_3];
    const { container } = render(SuggestedFollowsBanner);

    // Suggested rows should default to checked (it's an opt-in nudge — user can uncheck).
    const checkboxes = container.querySelectorAll('[data-testid="suggested-follow-checkbox"]');
    expect(checkboxes.length).toBe(3);

    // Uncheck the third one so we know the publish honors the selection.
    await fireEvent.click(checkboxes[2]);

    const followBtn = container.querySelector('[data-testid="follows-banner-follow"]');
    await fireEvent.click(/** @type {HTMLElement} */ (followBtn));

    // Allow the sign + publish microtasks to resolve.
    await new Promise((r) => setTimeout(r, 0));

    expect(mockPublishEvent).toHaveBeenCalled();
    const event = mockPublishEvent.mock.calls[0][0];
    expect(event.kind).toBe(3);
    const pTags = event.tags.filter((t) => t[0] === 'p').map((t) => t[1]);
    expect(pTags).toEqual([PUBKEY_1, PUBKEY_2]);
  });

  it('hides the banner immediately after click without waiting on publishEvent', async () => {
    // Make publishEvent block forever so the assertion can only pass if the
    // banner was hidden BEFORE the publish round-trip resolves. Mirrors the
    // optimistic+fire-and-forget pattern used in SignupModal.finishProfile.
    let resolvePublish = () => {};
    mockPublishEvent.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolvePublish = () => res({ success: true });
        })
    );

    mockConfig.runtimeConfig.signup.suggestedUsers = [NPUB_1];
    const { container } = render(SuggestedFollowsBanner);

    const followBtn = container.querySelector('[data-testid="follows-banner-follow"]');
    await fireEvent.click(/** @type {HTMLElement} */ (followBtn));

    // One tick for the sign() microtask. publishEvent is still pending.
    await new Promise((r) => setTimeout(r, 0));

    // Optimistic state: banner gone, dismiss flag persisted, eventStore got the event.
    expect(localStorage.getItem(`follows-banner-dismissed:${ACTIVE_PUBKEY}`)).toBe('1');
    expect(container.querySelector('[data-testid="suggested-follows-banner"]')).toBeNull();
    expect(mockEventStore.add).toHaveBeenCalled();
    // publishEvent fired (fire-and-forget) but didn't need to resolve.
    expect(mockPublishEvent).toHaveBeenCalled();

    // Cleanup the never-resolved promise.
    resolvePublish();
  });
});
