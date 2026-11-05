// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import ProfileHeader from '../profile/ProfileHeader.svelte';
import { modalStore } from '$lib/stores/modal.svelte.js';

// WaveButton spins up loaders/relay subscriptions — irrelevant here.
vi.mock('../waves/WaveButton.svelte', async () => {
  const { default: Stub } = await import('./fixtures/StubComponent.svelte');
  return { default: Stub };
});
// The explainer card reads config + the viewer's profile — stubbed here.
vi.mock('../shared/Nip05InfoCard.svelte', async () => {
  const mock = await import('./__mocks__/Nip05InfoCardMock.svelte');
  return { default: mock.default };
});

// The license row looks kind-1063 attestations up by Blossom hash; the test
// decides per hash what the lookup yields (issue 1ff3b524).
const licenseHolders = vi.hoisted(() => ({
  /** @type {Record<string, {event: any, status: string}>} */ byHash: {}
}));
vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseStatus: (/** @type {() => string | null} */ getHash) => () => {
    const hash = getHash();
    if (!hash) return { event: null, status: 'missing' };
    return licenseHolders.byHash[hash] ?? { event: null, status: 'missing' };
  }
}));

// Opening the chip's popover runs a Svelte fade transition; jsdom has no
// Web Animations API, so give it an instantly finished stand-in.
if (!Element.prototype.animate) {
  Element.prototype.animate = function () {
    const finished = Promise.resolve();
    const anim = {
      onfinish: null,
      cancel: vi.fn(),
      finished,
      currentTime: null,
      playState: 'finished'
    };
    finished.then(() => anim.onfinish?.());
    return anim;
  };
}

const PUBKEY = 'a'.repeat(64);
const NPUB = 'npub1' + 'x'.repeat(59);

function baseProps(overrides = {}) {
  return {
    pubkey: PUBKEY,
    npub: NPUB,
    profile: { name: 'Musterfrau', about: 'Hallo' },
    profileEvent: { id: 'e'.repeat(64), kind: 0, pubkey: PUBKEY },
    nip05s: [],
    nip05Status: 'pending',
    isOwnProfile: false,
    activeUser: { pubkey: 'b'.repeat(64) },
    isFollowing: false,
    followLoading: false,
    postsCount: 0,
    editing: false,
    isCommunity: false,
    onFollow: vi.fn(),
    onToggleEdit: vi.fn(),
    onEditProfile: vi.fn(),
    ...overrides
  };
}

describe('<ProfileHeader>', () => {
  afterEach(() => {
    // narrow-viewport tests stub window.matchMedia; never let it leak
    delete window.matchMedia;
  });

  it('shows no verified chip: the NIP-05 line itself is the verified marker', () => {
    const { container } = render(
      ProfileHeader,
      baseProps({ nip05Status: 'verified', nip05s: ['_@sebastix.dev'] })
    );
    expect(container.querySelector('[data-testid="profile-verified-chip"]')).toBeNull();
    expect(container.querySelector('[data-testid="profile-nip05-line"]')).toBeTruthy();
  });

  it.skip('(replaced) shows the verified chip when the aggregate status is verified', () => {
    const { container } = render(ProfileHeader, baseProps({ nip05Status: 'verified' }));
    expect(container.querySelector('[data-testid="profile-verified-chip"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="profile-unverified-chip"]')).toBeFalsy();
  });

  // Issue "Erklärung/Anleitung Verifizierung": the chip used to be inert, so
  // new users had no way to learn what "Verifiziert" and the @-address mean.
  it('opens the explainer popover from the NIP-05 line', async () => {
    const { container, queryByTestId } = render(
      ProfileHeader,
      baseProps({ nip05Status: 'verified', nip05s: ['_@sebastix.dev'] })
    );
    expect(queryByTestId('nip05-info-card-mock')).toBeNull();
    await fireEvent.click(container.querySelector('[data-testid="profile-nip05-line"]'));
    expect(queryByTestId('nip05-info-card-mock')).toBeTruthy();
  });

  it('shows the unverified chip when the aggregate status is unverified', () => {
    const { container } = render(ProfileHeader, baseProps({ nip05Status: 'unverified' }));
    expect(container.querySelector('[data-testid="profile-unverified-chip"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="profile-verified-chip"]')).toBeFalsy();
  });

  it('shows no chip while verification is pending', () => {
    const { container } = render(ProfileHeader, baseProps({ nip05Status: 'pending' }));
    expect(container.querySelector('[data-testid="profile-verified-chip"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="profile-unverified-chip"]')).toBeFalsy();
  });

  it('renders follow button and message link for a logged-in visitor', () => {
    const { container } = render(ProfileHeader, baseProps());
    expect(container.querySelector('[data-testid="follow-button"]')).toBeTruthy();
    const dm = container.querySelector(`a[href*="/c/messages?to=${PUBKEY}"]`);
    expect(dm).toBeTruthy();
  });

  it('calls onFollow when the follow button is clicked', async () => {
    const onFollow = vi.fn();
    const { container } = render(ProfileHeader, baseProps({ onFollow }));
    container.querySelector('[data-testid="follow-button"]').click();
    expect(onFollow).toHaveBeenCalledOnce();
  });

  it('shows a zap link only when the profile has a lud16', () => {
    const withZap = render(
      ProfileHeader,
      baseProps({ profile: { name: 'M', lud16: 'm@wallet.com' } })
    );
    expect(withZap.container.querySelector('[data-testid="zap-link"]')).toBeTruthy();
    withZap.unmount();
    const withoutZap = render(ProfileHeader, baseProps());
    expect(withoutZap.container.querySelector('[data-testid="zap-link"]')).toBeFalsy();
  });

  it('renders owner controls instead of visitor buttons on own profile', () => {
    const { container } = render(
      ProfileHeader,
      baseProps({ isOwnProfile: true, activeUser: { pubkey: PUBKEY } })
    );
    expect(container.querySelector('[data-testid="customize-tabs"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="edit-profile"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="follow-button"]')).toBeFalsy();
  });

  it('calls onToggleEdit from the customize button', async () => {
    const onToggleEdit = vi.fn();
    const { container } = render(
      ProfileHeader,
      baseProps({ isOwnProfile: true, activeUser: { pubkey: PUBKEY }, onToggleEdit })
    );
    container.querySelector('[data-testid="customize-tabs"]').click();
    expect(onToggleEdit).toHaveBeenCalledOnce();
  });

  it('renders no banner at all when the profile has none set', () => {
    const { container } = render(ProfileHeader, baseProps({ profile: { name: 'M', banner: '' } }));
    expect(container.querySelector('.pf-banner')).toBeFalsy();
    expect(container.querySelector('.pf-head')?.className).toMatch(/no-banner/);
  });

  it('renders the banner image when one is set', () => {
    const { container } = render(
      ProfileHeader,
      baseProps({ profile: { name: 'M', banner: 'https://example.org/b.jpg' } })
    );
    expect(container.querySelector('.pf-banner img')).toBeTruthy();
    expect(container.querySelector('.pf-head')?.className).not.toMatch(/no-banner/);
  });

  // Issue 9f7816e3: the pill's QR button opens the profile's QR code (and
  // from there the scanner) — on every profile, not just the own one.
  it('opens the profile QR modal from the more menu', async () => {
    modalStore.closeModal();
    const { container } = render(ProfileHeader, baseProps());
    expect(container.querySelector('[data-testid="npub-pill"]')).toBeNull();
    const button = container.querySelector(
      '[data-testid="profile-more-menu"] [data-testid="show-qr"]'
    );
    expect(button).toBeTruthy();
    await fireEvent.click(button);
    expect(modalStore.activeModal).toBe('profileQr');
    expect(modalStore.modalProps).toEqual({ pubkey: PUBKEY, npub: NPUB });
    modalStore.closeModal();
  });

  it('offers the truncated npub to copy inside the more menu', () => {
    const { container } = render(ProfileHeader, baseProps());
    const item = container.querySelector(
      '[data-testid="profile-more-menu"] [data-testid="copy-npub"]'
    );
    expect(item).toBeTruthy();
    expect(item.textContent).toContain('npub1');
    expect(item.textContent.length).toBeLessThan(NPUB.length + 40);
  });

  it('following: a person-dash button named Entfolgen; the actual unfollow is one tap down', async () => {
    const onFollow = vi.fn();
    const { container } = render(ProfileHeader, baseProps({ isFollowing: true, onFollow }));
    const btn = container.querySelector('[data-testid="follow-button"]');
    expect(btn.getAttribute('aria-label')).toMatch(/Entfolgen|Unfollow/);
    expect(btn.querySelector('svg title')?.textContent).not.toMatch(/check/i);
    await fireEvent.click(btn);
    expect(onFollow).not.toHaveBeenCalled();
    await fireEvent.click(container.querySelector('[data-testid="unfollow-button"]'));
    expect(onFollow).toHaveBeenCalledTimes(1);
  });

  it('not following: a person-add button named Folgen', () => {
    const { container } = render(ProfileHeader, baseProps({ isFollowing: false }));
    const btn = container.querySelector('[data-testid="follow-button"]');
    expect(btn.getAttribute('aria-label')).toMatch(/Folgen|Follow/);
    expect(btn.querySelector('svg title')?.textContent).toMatch(/person/i);
  });

  it('wide: the row is icon-only squares with accessible names; phone: labelled buttons', () => {
    const wide = render(ProfileHeader, baseProps());
    const follow = wide.container.querySelector('[data-testid="follow-button"]');
    // icon only: the button's text is nothing but the SVG's own title
    const onlyIcon = (el) =>
      el.textContent.trim() === (el.querySelector('svg')?.textContent ?? '').trim();
    expect(follow.classList.contains('icon')).toBe(true);
    expect(follow.getAttribute('aria-label')).toBeTruthy();
    expect(onlyIcon(follow)).toBe(true);
    // same paper square as Nachricht / wave / more — not the ink CTA
    expect(follow.classList.contains('ghost')).toBe(true);
    expect(follow.classList.contains('solid')).toBe(false);
    const dm = wide.container.querySelector(`a[href*="/c/messages?to=${PUBKEY}"]`);
    expect(dm.classList.contains('icon')).toBe(true);
    expect(onlyIcon(dm)).toBe(true);
    wide.unmount();
    window.matchMedia = (query) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false
    });
    const narrow = render(ProfileHeader, baseProps());
    const nfollow = narrow.container.querySelector('[data-testid="follow-button"]');
    expect(nfollow.classList.contains('icon')).toBe(false);
    expect(onlyIcon(nfollow)).toBe(false);
    expect(nfollow.classList.contains('solid')).toBe(true);
    narrow.unmount();
  });

  it('puts the wave in the button row on wide screens and on the avatar on phones', () => {
    const wide = render(ProfileHeader, baseProps());
    expect(wide.container.querySelector('[data-testid="wave-row"]')).toBeTruthy();
    expect(wide.container.querySelector('[data-testid="wave-avatar"]')).toBeNull();
    wide.unmount();
    window.matchMedia = (query) => ({
      matches: query.includes('max-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false
    });
    const narrow = render(ProfileHeader, baseProps());
    expect(narrow.container.querySelector('[data-testid="wave-avatar"]')).toBeTruthy();
    expect(narrow.container.querySelector('[data-testid="wave-row"]')).toBeNull();
    narrow.unmount();
    delete window.matchMedia;
  });

  // NIP-24: display_name is the rendered name, name the handle-style fallback.
  // We had the precedence inverted and printed a hardcoded 'Anonymous User'
  // when a profile carried only a picture — which other clients' users read as
  // a name we had published (issue: kind 0 metadata interop).
  it('prefers display_name over name', () => {
    const { container } = render(
      ProfileHeader,
      baseProps({ profile: { display_name: 'ALPIKA Grundschule', name: 'alpika' } })
    );
    expect(container.querySelector('.pf-identity h1')?.textContent).toContain('ALPIKA Grundschule');
  });

  it('falls back to the short npub instead of a placeholder word', () => {
    const { container } = render(
      ProfileHeader,
      baseProps({ profile: { picture: 'https://example.org/a.png' } })
    );
    const heading = container.querySelector('.pf-identity h1')?.textContent || '';
    expect(heading).not.toMatch(/anonymous/i);
    expect(heading).toContain('npub1');
  });

  // A community IS an npub, so its key also carries a plain kind 0 and lands
  // on /p like any person. Without a marker nothing tells the visitor that a
  // community page exists for this key (issue: show community on profile).
  describe('community marker', () => {
    it('wide: the community chip is the link to /c/<npub>, no extra button', () => {
      const { container } = render(ProfileHeader, baseProps({ isCommunity: true }));
      const chip = container.querySelector('[data-testid="profile-community-chip"]');
      expect(chip).toBeTruthy();
      expect(chip.getAttribute('href')).toContain(`/c/${NPUB}`);
      expect(container.querySelector('[data-testid="open-community-button"]')).toBeNull();
    });

    it('phone: a community card below the buttons links to /c/<npub>', () => {
      window.matchMedia = (query) => ({
        matches: query.includes('max-width'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false
      });
      const { container } = render(ProfileHeader, baseProps({ isCommunity: true }));
      const card = container.querySelector('[data-testid="open-community-button"]');
      expect(card).toBeTruthy();
      expect(card.getAttribute('href')).toContain(`/c/${NPUB}`);
      expect(container.querySelector('[data-testid="profile-community-chip"]')).toBeNull();
      delete window.matchMedia;
    });

    it('renders neither marker when the pubkey is not a community', () => {
      const { container } = render(ProfileHeader, baseProps({ isCommunity: false }));
      expect(container.querySelector('[data-testid="profile-community-chip"]')).toBeFalsy();
      expect(container.querySelector('[data-testid="open-community-button"]')).toBeFalsy();
    });

    it('defaults to no marker when the prop is omitted', () => {
      const props = baseProps();
      delete props.isCommunity;
      const { container } = render(ProfileHeader, props);
      expect(container.querySelector('[data-testid="profile-community-chip"]')).toBeFalsy();
    });

    it('keeps the community link for anonymous visitors and for the owner', () => {
      const anon = render(ProfileHeader, baseProps({ isCommunity: true, activeUser: null }));
      expect(anon.container.querySelector('[data-testid="profile-community-chip"]')).toBeTruthy();
      anon.unmount();
      const owner = render(
        ProfileHeader,
        baseProps({ isCommunity: true, isOwnProfile: true, activeUser: { pubkey: PUBKEY } })
      );
      expect(owner.container.querySelector('[data-testid="profile-community-chip"]')).toBeTruthy();
    });

    it('coexists with a verified NIP-05 line', () => {
      const { container } = render(
        ProfileHeader,
        baseProps({ isCommunity: true, nip05Status: 'verified', nip05s: ['_@x.dev'] })
      );
      expect(container.querySelector('[data-testid="profile-nip05-line"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="profile-community-chip"]')).toBeTruthy();
    });
  });

  it('shows the posts stat only when a count is available', () => {
    const withCount = render(ProfileHeader, baseProps({ postsCount: 12 }));
    expect(withCount.container.querySelector('[data-testid="stat-posts"]')?.textContent).toContain(
      '12'
    );
    withCount.unmount();
    const withoutCount = render(ProfileHeader, baseProps({ postsCount: 0 }));
    expect(withoutCount.container.querySelector('[data-testid="stat-posts"]')).toBeFalsy();
  });

  it('renders the posts stat as a button that jumps to the posts tab', async () => {
    const onShowPosts = vi.fn();
    const { getByTestId } = render(ProfileHeader, baseProps({ postsCount: 12, onShowPosts }));
    const posts = getByTestId('stat-posts');
    expect(posts.tagName).toBe('BUTTON');
    expect(posts.getAttribute('type')).toBe('button');
    expect(posts.classList.contains('pf-stat')).toBe(true);
    expect(posts.textContent).toMatch(/12/);
    await fireEvent.click(posts);
    expect(onShowPosts).toHaveBeenCalledTimes(1);
  });

  it('keeps the posts stat plain text when there is no tab to jump to', () => {
    const { getByTestId } = render(ProfileHeader, baseProps({ postsCount: 12 }));
    expect(getByTestId('stat-posts').tagName).toBe('SPAN');
  });

  // Issue 1ff3b524: a profile picture uploaded through the app carries a
  // kind-1063 license like any other upload, but the page never showed it.
  describe('image licenses', () => {
    const HASH = 'c'.repeat(64);
    const PICTURE = `https://blossom.edufeed.org/${HASH}.png`;

    beforeEach(() => {
      licenseHolders.byHash = {};
    });

    it('lists the picture license below the identity block', () => {
      licenseHolders.byHash[HASH] = {
        status: 'found',
        event: {
          id: 'd'.repeat(64),
          kind: 1063,
          pubkey: PUBKEY,
          created_at: 1,
          content: '',
          tags: [
            ['x', HASH],
            ['license', 'https://creativecommons.org/licenses/by/4.0/'],
            ['credit', 'Nadine Glage']
          ]
        }
      };
      const { container } = render(
        ProfileHeader,
        baseProps({ profile: { name: 'M', picture: PICTURE }, postsCount: 3 })
      );
      // Exactly one row, regardless of the posts stat being rendered next to it.
      const rows = container.querySelectorAll(
        '.pf-identity [data-testid="profile-image-licenses"]'
      );
      expect(rows.length).toBe(1);
      const row = rows[0];
      expect(row.textContent).toContain('CC BY 4.0');
      expect(row.textContent).toContain('Nadine Glage');
    });

    it('shows no caution for an avatar without an attestation', () => {
      const { container } = render(
        ProfileHeader,
        baseProps({ profile: { name: 'M', picture: PICTURE } })
      );
      expect(container.querySelector('[data-testid="profile-image-licenses"]')).toBeFalsy();
      expect(container.querySelector('[data-testid="license-caution"]')).toBeFalsy();
    });
  });

  describe('follow stats (issue 891be310)', () => {
    it('shows follower and following counts as buttons that open the lists', async () => {
      const onShowFollowers = vi.fn();
      const onShowFollowing = vi.fn();
      const { getByTestId } = render(ProfileHeader, {
        props: baseProps({
          followersCount: 108,
          followingCount: 74,
          onShowFollowers,
          onShowFollowing
        })
      });
      const followers = getByTestId('stat-followers');
      const following = getByTestId('stat-following');
      expect(followers.textContent).toMatch(/108/);
      expect(following.textContent).toMatch(/74/);
      await fireEvent.click(followers);
      await fireEvent.click(following);
      expect(onShowFollowers).toHaveBeenCalled();
      expect(onShowFollowing).toHaveBeenCalled();
    });

    it('reads 500+ once the follower fetch is capped', () => {
      const { getByTestId } = render(ProfileHeader, {
        props: baseProps({ followersCount: 500, followersCapped: true, followingCount: 3 })
      });
      expect(getByTestId('stat-followers').textContent).toMatch(/500\+/);
    });

    it('hides a stat while it is zero or unknown', () => {
      const { queryByTestId } = render(ProfileHeader, { props: baseProps() });
      expect(queryByTestId('stat-followers')).toBeNull();
      expect(queryByTestId('stat-following')).toBeNull();
    });
  });
});
