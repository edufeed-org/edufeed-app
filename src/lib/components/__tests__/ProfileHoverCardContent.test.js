/**
 * ProfileHoverCardContent Component Tests
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import ProfileHoverCardContent from '../shared/ProfileHoverCardContent.svelte';

// Follow-button fixtures, hoisted so the mock factories below can read them.
const { activeUserRef, contactsRef, contactListRef, toggleFollow } = vi.hoisted(() => ({
  activeUserRef: /** @type {{ value: any }} */ ({ value: null }),
  contactsRef: /** @type {{ contacts: string[], isLoaded: boolean }} */ ({
    contacts: [],
    isLoaded: false
  }),
  // The active user's own kind 3 as the eventStore would hand it out
  // (undefined = not loaded / absent).
  contactListRef: /** @type {{ value: any }} */ ({ value: undefined }),
  toggleFollow: vi.fn(async () => true)
}));

vi.mock('applesauce-core/helpers', () => ({
  getDisplayName: (/** @type {any} */ profile) => profile?.display_name || profile?.name || null
}));

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  hexToNpub: (/** @type {string} */ hex) => (hex ? `npub1${hex.slice(0, 59)}` : null),
  generateAuthorColor: (/** @type {string} */ _hex) => `rgb(128,64,32)`,
  profileLink: (/** @type {string} */ hex) => (hex ? `/p/npub1${hex.slice(0, 59)}` : '#')
}));

vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

vi.mock('../shared/ImageWithFallback.svelte', async () => {
  return {
    default: (/** @type {any} */ _anchor, /** @type {any} */ _props) => ({})
  };
});

vi.mock('../shared/ProfileAvatar.svelte', async () => {
  return {
    default: (/** @type {any} */ _anchor, /** @type {any} */ _props) => ({})
  };
});

vi.mock('../waves/WaveButton.svelte', async () => {
  return {
    default: (/** @type {any} */ _anchor, /** @type {any} */ _props) => ({})
  };
});

vi.mock('$lib/components/icons', () => ({
  CheckIcon: (/** @type {any} */ _anchor, /** @type {any} */ _props) => ({}),
  PlusIcon: (/** @type {any} */ _anchor, /** @type {any} */ _props) => ({})
}));

vi.mock('$lib/paraglide/messages', () => ({
  profile_avatar_alt: () => 'Avatar',
  profile_avatar_fallback: () => '?',
  profile_follow_button: () => 'Folgen',
  profile_unfollow_button: () => 'Entfolgen'
}));

vi.mock('$lib/helpers/follow.js', () => ({ toggleFollow }));

vi.mock('$lib/stores/contacts.svelte.js', () => ({
  contactsStore: {
    get contacts() {
      return contactsRef.contacts;
    },
    get isLoaded() {
      return contactsRef.isLoaded;
    }
  }
}));

vi.mock('$lib/loaders/profile.js', () => ({
  profileLoader: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) })
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    model: () => ({ subscribe: () => ({ unsubscribe: vi.fn() }) }),
    replaceable: (/** @type {number} */ kind) => ({
      subscribe: (/** @type {(e: any) => void} */ next) => {
        if (kind === 3) next(contactListRef.value);
        return { unsubscribe: vi.fn() };
      }
    })
  }
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { fallbackRelays: [] }
}));

vi.mock('applesauce-core/models', () => ({
  ProfileModel: {},
  TimelineModel: {}
}));

vi.mock('$lib/stores/badge-awards.svelte.js', () => ({
  useProfileBadges: () => ({
    getBadges: () => [],
    isLoading: false
  })
}));

vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => activeUserRef.value
}));

beforeEach(() => {
  vi.clearAllMocks();
  activeUserRef.value = null;
  contactsRef.contacts = [];
  contactsRef.isLoaded = false;
  contactListRef.value = undefined;
});

const TEST_PUBKEY = 'a'.repeat(64);
const ME = 'b'.repeat(64);

/** Logged in as ME with a loaded kind 3 that follows `contacts`. */
function loginWithContacts(/** @type {string[]} */ contacts) {
  activeUserRef.value = { pubkey: ME };
  contactsRef.contacts = contacts;
  contactsRef.isLoaded = true;
  contactListRef.value = { kind: 3, pubkey: ME, tags: contacts.map((p) => ['p', p]) };
}

describe('ProfileHoverCardContent follow button', () => {
  it('is hidden when logged out', () => {
    const { queryByTestId } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    expect(queryByTestId('hover-card-follow')).toBeNull();
  });

  it('is hidden on the own profile', () => {
    loginWithContacts([]);
    const { queryByTestId } = render(ProfileHoverCardContent, {
      props: { pubkey: ME, profile: { name: 'Me' } }
    });
    expect(queryByTestId('hover-card-follow')).toBeNull();
  });

  it('is hidden while the own contact list has not arrived (never offers Follow over an unloaded kind 3)', () => {
    activeUserRef.value = { pubkey: ME };
    contactsRef.isLoaded = true; // ContactsModel emitted [] for a missing event
    contactListRef.value = undefined;
    const { queryByTestId } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    expect(queryByTestId('hover-card-follow')).toBeNull();
  });

  it('offers Folgen for a user not yet followed', () => {
    loginWithContacts(['c'.repeat(64)]);
    const { getByTestId } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    const btn = getByTestId('hover-card-follow');
    expect(btn.textContent).toContain('Folgen');
    expect(btn.className).toContain('btn-sm');
  });

  it('offers Entfolgen for a followed user', () => {
    loginWithContacts([TEST_PUBKEY]);
    const { getByTestId } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    expect(getByTestId('hover-card-follow').textContent).toContain('Entfolgen');
  });

  it('runs the shared toggleFollow without navigating the card link', async () => {
    loginWithContacts([]);
    const { getByTestId } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    const btn = getByTestId('hover-card-follow');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    btn.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(toggleFollow).toHaveBeenCalledWith(TEST_PUBKEY, false));
  });

  it('disables the button while the action is pending', async () => {
    loginWithContacts([TEST_PUBKEY]);
    /** @type {() => void} */
    let resolve = () => {};
    toggleFollow.mockImplementationOnce(() => new Promise((r) => (resolve = () => r(true))));
    const { getByTestId } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    const btn = /** @type {HTMLButtonElement} */ (getByTestId('hover-card-follow'));
    await fireEvent.click(btn);
    expect(btn.disabled).toBe(true);
    resolve();
    await waitFor(() => expect(btn.disabled).toBe(false));
  });
});

describe('ProfileHoverCardContent', () => {
  it('renders display name from profile', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { display_name: 'Alice' } }
    });
    expect(container.textContent).toContain('Alice');
  });

  it('shows NIP-05 when profile has nip05', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice', nip05: 'alice@example.com' } }
    });
    expect(container.textContent).toContain('alice@example.com');
    // Should NOT show npub when nip05 is present
    const npubText = `npub1${'a'.repeat(59)}`.slice(0, 16);
    expect(container.textContent).not.toContain(npubText);
  });

  it('falls back to npub when no nip05', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    const npubText = `npub1${'a'.repeat(59)}`.slice(0, 16);
    expect(container.textContent).toContain(npubText);
  });

  it('renders no banner at all when the profile has none set', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    // Design: the no-banner variant leaves the banner out entirely
    expect(container.querySelector('.h-16')).toBeNull();
  });

  it('truncates bio to 100 chars with ellipsis', () => {
    const longBio = 'x'.repeat(150);
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice', about: longBio } }
    });
    expect(container.textContent).toContain('x'.repeat(100) + '…');
    expect(container.textContent).not.toContain('x'.repeat(101));
  });

  it('shows full bio when under 100 chars', () => {
    const shortBio = 'A short bio about Alice.';
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice', about: shortBio } }
    });
    expect(container.textContent).toContain(shortBio);
  });

  it('handles null profile gracefully with pubkey fallback', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: null }
    });
    expect(container.textContent).toContain(TEST_PUBKEY.slice(0, 8));
  });

  it('handles undefined profile gracefully', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY }
    });
    expect(container.textContent).toContain(TEST_PUBKEY.slice(0, 8));
  });

  it('card links to profile page', () => {
    const { container } = render(ProfileHoverCardContent, {
      props: { pubkey: TEST_PUBKEY, profile: { name: 'Alice' } }
    });
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe(`/p/npub1${TEST_PUBKEY.slice(0, 59)}`);
  });
});
