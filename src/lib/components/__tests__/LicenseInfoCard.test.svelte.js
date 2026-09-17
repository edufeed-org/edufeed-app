/** @vitest-environment jsdom */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';

/** @type {Map<string, any>} */
let profiles = new Map();

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => profiles
}));
vi.mock('$app/paths', () => ({
  resolve: (/** @type {string} */ path) => path
}));

import LicenseInfoCard from '$lib/components/shared/LicenseInfoCard.svelte';

const ATTESTER = 'b'.repeat(64);
const CREATOR = '1'.repeat(64);
const HEX_RE = /[0-9a-f]{64}/;

/** @param {string[][]} [extraTags] */
function licenseEvent(extraTags = []) {
  return {
    id: 'a'.repeat(64),
    pubkey: ATTESTER,
    kind: 1063,
    created_at: 1000,
    content: '',
    tags: [
      ['url', 'https://blossom.example/aaa.jpg'],
      ['x', 'a'.repeat(64)],
      ['m', 'image/jpeg'],
      ['license', 'https://creativecommons.org/licenses/by/4.0/'],
      ['credit', 'Jane Doe'],
      ...extraTags
    ],
    sig: 'c'.repeat(128)
  };
}

describe('LicenseInfoCard', () => {
  it('shows the license label as a link to the license deed, plus the credit', () => {
    profiles = new Map();
    const { getByTestId, getByText } = render(LicenseInfoCard, { licenseEvent: licenseEvent() });
    const licenseLink = /** @type {HTMLAnchorElement} */ (getByTestId('license-info-license'));
    expect(licenseLink.tagName).toBe('A');
    expect(licenseLink.textContent).toContain('CC BY 4.0');
    expect(licenseLink.getAttribute('href')).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(getByText('Jane Doe')).toBeTruthy();
  });

  it('shows title, alt text and a source link when the attestation carries them', () => {
    profiles = new Map();
    const { getByTestId, getByText } = render(LicenseInfoCard, {
      licenseEvent: licenseEvent([
        ['title', 'Berlin skyline'],
        ['alt', 'Skyline at dusk'],
        ['source', 'https://example.org/photos/1']
      ])
    });
    expect(getByText('Berlin skyline')).toBeTruthy();
    expect(getByText('Skyline at dusk')).toBeTruthy();
    const source = /** @type {HTMLAnchorElement} */ (getByTestId('license-info-source'));
    expect(source.tagName).toBe('A');
    expect(source.getAttribute('href')).toBe('https://example.org/photos/1');
    expect(source.getAttribute('rel')).toContain('noopener');
  });

  it('omits rows whose tags are absent', () => {
    profiles = new Map();
    const { queryByTestId } = render(LicenseInfoCard, { licenseEvent: licenseEvent() });
    expect(queryByTestId('license-info-title')).toBeNull();
    expect(queryByTestId('license-info-alt')).toBeNull();
    expect(queryByTestId('license-info-source')).toBeNull();
    expect(queryByTestId('license-info-creator')).toBeNull();
  });

  it('renders a non-http source as plain text, not a link', () => {
    profiles = new Map();
    const { getByTestId } = render(LicenseInfoCard, {
      licenseEvent: licenseEvent([['source', 'javascript:alert(1)']])
    });
    const source = getByTestId('license-info-source');
    expect(source.tagName).not.toBe('A');
    expect(source.textContent).toContain('javascript:alert(1)');
  });

  it('shows the creator and attester as profile names linking to their profiles', () => {
    profiles = new Map([
      [CREATOR, { name: 'alice' }],
      [ATTESTER, { display_name: 'Bob Builder' }]
    ]);
    const { getByTestId, container } = render(LicenseInfoCard, {
      licenseEvent: licenseEvent([['p', CREATOR]])
    });
    const creator = /** @type {HTMLAnchorElement} */ (getByTestId('license-info-creator'));
    expect(creator.textContent).toContain('alice');
    expect(creator.getAttribute('href')).toBe(`/p/${nip19.npubEncode(CREATOR)}`);
    const attester = /** @type {HTMLAnchorElement} */ (getByTestId('license-info-attester'));
    expect(attester.textContent).toContain('Bob Builder');
    expect(attester.getAttribute('href')).toBe(`/p/${nip19.npubEncode(ATTESTER)}`);
    expect(container.textContent).not.toMatch(HEX_RE);
  });

  it('falls back to a shortened npub (never raw hex) while the profile is unknown', () => {
    profiles = new Map();
    const { getByTestId, container } = render(LicenseInfoCard, {
      licenseEvent: licenseEvent([['p', CREATOR]])
    });
    expect(getByTestId('license-info-creator').textContent).toMatch(/npub1[a-z0-9]+…/);
    expect(getByTestId('license-info-attester').textContent).toMatch(/npub1[a-z0-9]+…/);
    expect(container.textContent).not.toMatch(HEX_RE);
  });

  it('ignores a malformed p tag (untrusted input)', () => {
    profiles = new Map();
    const { queryByTestId } = render(LicenseInfoCard, {
      licenseEvent: licenseEvent([['p', 'not-a-pubkey']])
    });
    expect(queryByTestId('license-info-creator')).toBeNull();
  });

  it('labels AI-generated content', () => {
    profiles = new Map();
    const { getByTestId } = render(LicenseInfoCard, {
      licenseEvent: licenseEvent([['ai', 'generated']])
    });
    expect(getByTestId('license-info-ai').textContent).toContain('AI generated');
  });
});
