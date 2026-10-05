// @ts-nocheck
/**
 * ProfileCard — the opt-in `showNip05` / `showAbout` details used by the
 * discover "Personen" tab: the NIP-05 identifier (through the verifying
 * badge) and a clamped plain-text bio. Other callers keep the compact
 * name + npub card.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import ProfileCard from '../shared/ProfileCard.svelte';

const PUBKEY = 'a'.repeat(64);

const state = vi.hoisted(() => ({ profile: undefined }));

vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => state.profile
}));
vi.mock('../shared/ProfileAvatar.svelte', () => import('./fixtures/ProfileAvatarStub.svelte'));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock('$lib/helpers/nip05-verify.js', () => ({
  verifyNip05: () => Promise.resolve('verified')
}));
vi.mock('$lib/paraglide/messages', () => ({
  nip05_verified_label: () => 'verified',
  nip05_mismatch_label: () => 'mismatch',
  nip05_unverified_label: () => 'unverified'
}));

beforeEach(() => {
  state.profile = undefined;
});

describe('ProfileCard details', () => {
  it('shows display name, NIP-05 and bio when requested and present', async () => {
    state.profile = {
      name: 'laoc',
      display_name: 'Laoc',
      nip05: 'laoc@edufeed.org',
      about: 'Builds <b>open</b> education tools.\nSecond line.'
    };
    const { container, findByTestId } = render(ProfileCard, {
      props: { pubkey: PUBKEY, size: 'sm', showNip05: true, showAbout: true }
    });
    expect(container.textContent).toContain('Laoc');
    expect(container.textContent).toContain('laoc@edufeed.org');
    // Verified-style badge (verification resolves asynchronously).
    expect(await findByTestId('nip05-verified')).toBeTruthy();
    const about = container.querySelector('[data-testid="profile-card-about"]');
    expect(about?.textContent).toContain('Builds <b>open</b> education tools.');
    // Plain text, never HTML.
    expect(about?.querySelector('b')).toBeNull();
    expect(about?.className).toContain('line-clamp-2');
    // NIP-05 replaces the npub line.
    expect(container.textContent).not.toContain('npub1');
  });

  it('falls back to the npub and omits the bio when the profile has neither', () => {
    state.profile = { name: 'nobody' };
    const { container } = render(ProfileCard, {
      props: { pubkey: PUBKEY, size: 'sm', showNip05: true, showAbout: true }
    });
    expect(container.textContent).toContain('nobody');
    expect(container.textContent).toContain('npub1');
    expect(container.querySelector('[data-testid="profile-card-about"]')).toBeNull();
    expect(container.querySelector('[data-testid="nip05-verified"]')).toBeNull();
  });

  it('copes with a profile that has not loaded yet', () => {
    const { container } = render(ProfileCard, {
      props: { pubkey: PUBKEY, size: 'sm', showNip05: true, showAbout: true }
    });
    expect(container.textContent).toContain('aaaaaaaa...aaaa');
    expect(container.querySelector('[data-testid="profile-card-about"]')).toBeNull();
  });

  it('keeps the compact name + npub card for other callers', () => {
    state.profile = { name: 'laoc', nip05: 'laoc@edufeed.org', about: 'bio' };
    const { container } = render(ProfileCard, { props: { pubkey: PUBKEY, size: 'sm' } });
    expect(container.textContent).toContain('npub1');
    expect(container.textContent).not.toContain('laoc@edufeed.org');
    expect(container.querySelector('[data-testid="profile-card-about"]')).toBeNull();
  });
});
