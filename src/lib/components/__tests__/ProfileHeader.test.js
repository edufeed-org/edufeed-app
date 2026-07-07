// @ts-nocheck
/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import ProfileHeader from '../profile/ProfileHeader.svelte';

// WaveButton spins up loaders/relay subscriptions — irrelevant here.
vi.mock('../waves/WaveButton.svelte', async () => {
  const { default: Stub } = await import('./fixtures/StubComponent.svelte');
  return { default: Stub };
});

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
    onFollow: vi.fn(),
    onToggleEdit: vi.fn(),
    onEditProfile: vi.fn(),
    ...overrides
  };
}

describe('<ProfileHeader>', () => {
  it('shows the verified chip when the aggregate status is verified', () => {
    const { container } = render(ProfileHeader, baseProps({ nip05Status: 'verified' }));
    expect(container.querySelector('[data-testid="profile-verified-chip"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="profile-unverified-chip"]')).toBeFalsy();
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

  it('shows a truncated npub pill', () => {
    const { container } = render(ProfileHeader, baseProps());
    const pill = container.querySelector('[data-testid="npub-pill"]');
    expect(pill).toBeTruthy();
    expect(pill.textContent).toContain('npub1');
    expect(pill.textContent.length).toBeLessThan(NPUB.length);
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
});
