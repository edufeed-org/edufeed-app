// @ts-nocheck
/**
 * ProfileImageLicenses — the license row under a profile / community header
 * (issue 1ff3b524 "Lizenz auf Profilbild").
 *
 * Avatars are too small for the overlay pill, so the attestation is listed in
 * a row below the identity block instead: one entry per image (picture,
 * banner) that resolves to a kind-1063 license via its Blossom hash. Images
 * without a hash or without an attestation produce NOTHING — the
 * "Keine Lizenzangabe" caution would be noise on every robohash avatar.
 *
 * Labels are asserted in English: vitest runs Paraglide in its base locale.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const holders = vi.hoisted(() => ({
  /** @type {Record<string, {event: any, status: string}>} */
  byHash: {}
}));

vi.mock('$lib/stores/image-license.svelte.js', () => ({
  useLicenseStatus: (/** @type {() => string | null} */ getHash) => () => {
    const hash = getHash();
    if (!hash) return { event: null, status: 'missing' };
    return holders.byHash[hash] ?? { event: null, status: 'loading' };
  }
}));

import ProfileImageLicenses from '../shared/ProfileImageLicenses.svelte';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const BLOSSOM_A = `https://blossom.edufeed.org/${HASH_A}.png`;
const BLOSSOM_B = `https://blossom.edufeed.org/${HASH_B}.jpg`;

function licenseEvent(hash, credit) {
  return {
    id: 'e'.repeat(64),
    kind: 1063,
    pubkey: 'f'.repeat(64),
    created_at: 1,
    content: '',
    tags: [
      ['x', hash],
      ['license', 'https://creativecommons.org/licenses/by/4.0/'],
      ['credit', credit]
    ]
  };
}

describe('<ProfileImageLicenses>', () => {
  beforeEach(() => {
    holders.byHash = {};
  });

  it('lists the picture license when the Blossom hash resolves to a kind 1063', () => {
    holders.byHash[HASH_A] = { event: licenseEvent(HASH_A, 'Nadine Glage'), status: 'found' };
    const { container } = render(ProfileImageLicenses, { props: { picture: BLOSSOM_A } });
    const row = container.querySelector('[data-testid="profile-image-licenses"]');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('Profile picture');
    expect(row.textContent).toContain('CC BY 4.0');
    expect(row.textContent).toContain('Nadine Glage');
    expect(container.querySelector('[data-testid="license-badge"]')).toBeTruthy();
  });

  it('lists picture and banner separately, each with its own label', () => {
    holders.byHash[HASH_A] = { event: licenseEvent(HASH_A, 'Alice'), status: 'found' };
    holders.byHash[HASH_B] = { event: licenseEvent(HASH_B, 'Bob'), status: 'found' };
    const { container } = render(ProfileImageLicenses, {
      props: { picture: BLOSSOM_A, banner: BLOSSOM_B }
    });
    const entries = container.querySelectorAll('[data-testid="profile-image-license-entry"]');
    expect(entries.length).toBe(2);
    expect(entries[0].textContent).toContain('Profile picture');
    expect(entries[0].textContent).toContain('Alice');
    expect(entries[1].textContent).toContain('Banner');
    expect(entries[1].textContent).toContain('Bob');
  });

  it('renders nothing for a non-Blossom URL (no hash to look up)', () => {
    const { container } = render(ProfileImageLicenses, {
      props: { picture: 'https://robohash.org/abc', banner: 'https://example.org/b.jpg' }
    });
    expect(container.querySelector('[data-testid="profile-image-licenses"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="license-caution"]')).toBeFalsy();
  });

  it('renders nothing — not even the caution — when the hash has no attestation', () => {
    holders.byHash[HASH_A] = { event: null, status: 'missing' };
    const { container } = render(ProfileImageLicenses, { props: { picture: BLOSSOM_A } });
    expect(container.querySelector('[data-testid="profile-image-licenses"]')).toBeFalsy();
    expect(container.querySelector('[data-testid="license-caution"]')).toBeFalsy();
  });

  it('renders nothing while the lookup is still loading', () => {
    const { container } = render(ProfileImageLicenses, { props: { picture: BLOSSOM_A } });
    expect(container.querySelector('[data-testid="profile-image-licenses"]')).toBeFalsy();
  });
});
