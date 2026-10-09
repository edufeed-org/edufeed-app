// @ts-nocheck
/** @vitest-environment jsdom */
// Explainer card behind the "Verifiziert" chip (issue "Erklärung/Anleitung
// Verifizierung", design option 2a): the address itself on top, what the
// domain vouches for, three benefits as scannable rows, the e-mail
// misunderstanding named and defused, a deep link into the guide and — on
// other people's profiles — a CTA for viewers without an address of their own.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';

const mockConfig = vi.hoisted(() => ({
  appName: 'Edufeed',
  membership: { enabled: true, handleDomain: 'edufeed.org' },
  help: /** @type {{url: string | null}} */ ({ url: '/wiki/edufeed-erste-schritte' })
}));
const mockViewer = vi.hoisted(() => ({
  user: /** @type {any} */ ({ pubkey: 'viewer-pub' }),
  profile: /** @type {any} */ (null)
}));

vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: {
    get appName() {
      return mockConfig.appName;
    },
    get membership() {
      return mockConfig.membership;
    },
    get help() {
      return mockConfig.help;
    }
  }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockViewer.user
}));
vi.mock('$lib/stores/user-profile.svelte.js', () => ({
  useUserProfile: () => () => mockViewer.profile
}));

import Nip05InfoCard from '../shared/Nip05InfoCard.svelte';

const ADDRESS = 'alpika-grundschule@edufeed.org';

describe('<Nip05InfoCard>', () => {
  beforeEach(() => {
    mockConfig.membership = { enabled: true, handleDomain: 'edufeed.org' };
    mockConfig.help = { url: '/wiki/edufeed-erste-schritte' };
    mockViewer.user = { pubkey: 'viewer-pub' };
    mockViewer.profile = { name: 'Viewer' };
  });

  it('shows the address on top and the house lead for the deployment domain', () => {
    const { container } = render(Nip05InfoCard, { props: { nip05: ADDRESS } });
    expect(container.querySelector('[data-testid="nip05-info-address"]')?.textContent).toContain(
      ADDRESS
    );
    const lead = container.querySelector('[data-testid="nip05-info-lead"]')?.textContent ?? '';
    expect(lead).toContain('edufeed.org');
    expect(lead).toContain('Edufeed');
  });

  it('explains three benefits for a house address, with the domain filled in', () => {
    const { container } = render(Nip05InfoCard, { props: { nip05: ADDRESS } });
    const points = [...container.querySelectorAll('[data-testid="nip05-info-point"]')];
    expect(points).toHaveLength(3);
    expect(points[0].textContent).toContain('edufeed.org');
    expect(container.querySelector('[data-testid="nip05-info-not-email"]')).toBeTruthy();
  });

  it('uses the generic lead and drops the publishing point for a foreign domain', () => {
    const { container } = render(Nip05InfoCard, { props: { nip05: 'bob@nostrplebs.com' } });
    const lead = container.querySelector('[data-testid="nip05-info-lead"]')?.textContent ?? '';
    expect(lead).toContain('nostrplebs.com');
    expect(lead).not.toContain('Edufeed');
    const points = [...container.querySelectorAll('[data-testid="nip05-info-point"]')];
    expect(points).toHaveLength(2);
    expect(points[0].textContent).toContain('nostrplebs.com');
  });

  it('links into the guide section about verification', () => {
    const { container } = render(Nip05InfoCard, { props: { nip05: ADDRESS } });
    const link = container.querySelector('[data-testid="nip05-info-help-link"]');
    expect(link?.getAttribute('href')).toBe(
      '/wiki/edufeed-erste-schritte#was-bedeutet-verifiziert'
    );
    expect(link?.getAttribute('target')).toBeNull();
  });

  it('hides the guide link when no guide is configured', () => {
    mockConfig.help = { url: null };
    const { container } = render(Nip05InfoCard, { props: { nip05: ADDRESS } });
    expect(container.querySelector('[data-testid="nip05-info-help-link"]')).toBeNull();
  });

  it('offers the apply CTA to a logged-in viewer without an address', () => {
    const { container } = render(Nip05InfoCard, { props: { nip05: ADDRESS } });
    const cta = container.querySelector('[data-testid="nip05-info-apply-cta"]');
    expect(cta?.getAttribute('href')).toBe('/settings');
  });

  it('shows no CTA to verified viewers, unknown profiles, logged-out visitors or when membership is off', () => {
    const cta = (props) =>
      render(Nip05InfoCard, { props }).container.querySelector(
        '[data-testid="nip05-info-apply-cta"]'
      );
    mockViewer.profile = { name: 'Viewer', nip05: 'viewer@edufeed.org' };
    expect(cta({ nip05: ADDRESS })).toBeNull();
    mockViewer.profile = null;
    expect(cta({ nip05: ADDRESS })).toBeNull();
    mockViewer.profile = { name: 'x' };
    mockViewer.user = null;
    expect(cta({ nip05: ADDRESS })).toBeNull();
    mockViewer.user = { pubkey: 'viewer-pub' };
    mockConfig.membership = { enabled: false, handleDomain: '' };
    expect(cta({ nip05: ADDRESS })).toBeNull();
  });

  it('never shows the CTA when applyCta is off', () => {
    const { container } = render(Nip05InfoCard, { props: { nip05: ADDRESS, applyCta: false } });
    expect(container.querySelector('[data-testid="nip05-info-apply-cta"]')).toBeNull();
  });
});
