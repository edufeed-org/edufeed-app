/** @vitest-environment jsdom */
// Landing hero, design 5b (Claude Design "Landing Round 3"): copy A on the
// theme band, two actions plus the no-password hint, and a collage of live
// cards that shows only the cards there is content for.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const state = vi.hoisted(() => ({
  config: /** @type {any} */ ({}),
  openModal: vi.fn()
}));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: (/** @type {any[]} */ ...a) => state.openModal(...a) }
}));
vi.mock('$lib/stores/config.svelte.js', () => ({
  get runtimeConfig() {
    return state.config;
  }
}));
vi.mock('$lib/components/shared/ImageWithFallback.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'landing_hero_eyebrow',
      'landing_hero_title',
      'landing_hero_subtitle',
      'landing_cta_create_account',
      'landing_cta_browse',
      'landing_cta_hint',
      'landing_card_material',
      'landing_card_article',
      'landing_network_line',
      'landing_network_link'
    ].map((k) => [
      k,
      (/** @type {any} */ params) => (params ? `${k}:${JSON.stringify(params)}` : k)
    ])
  )
);

const { default: LandingHero } = await import('../landing/LandingHero.svelte');

const PK = 'a'.repeat(64);
const material = {
  id: 'm1',
  kind: 30142,
  pubkey: PK,
  identifier: 'res-1',
  name: 'Bruchrechnen mit Pizzastücken',
  image: 'https://img/x.png',
  license: { id: 'https://creativecommons.org/licenses/by/4.0/', label: 'CC BY 4.0' },
  rawEvent: { kind: 30142, pubkey: PK, tags: [['d', 'res-1']], created_at: 1 }
};
const nextEvent = {
  id: 'e1',
  kind: 31923,
  pubkey: PK,
  title: 'KI im Religionsunterricht',
  start: 1_800_000_000,
  location: 'Online',
  originalEvent: { kind: 31923, pubkey: PK, tags: [['d', 'ev-1']], created_at: 1 }
};

describe('LandingHero', () => {
  beforeEach(() => {
    state.config = { appName: 'Finder', ui: {}, help: { url: '/wiki/edufeed-erste-schritte' } };
    state.openModal.mockReset();
  });

  it('says what it is in copy A', () => {
    const { getByTestId } = render(LandingHero);
    const hero = getByTestId('landing-hero');
    for (const k of ['landing_hero_eyebrow', 'landing_hero_title', 'landing_hero_subtitle']) {
      expect(hero.textContent).toContain(k);
    }
    expect(getByTestId('landing-cta-hint').textContent).toContain('landing_cta_hint');
  });

  it('primary action opens signup, secondary links to discover', async () => {
    const { getByTestId } = render(LandingHero);
    expect(getByTestId('landing-cta-signup').textContent).toContain('landing_cta_create_account');
    await fireEvent.click(getByTestId('landing-cta-signup'));
    expect(state.openModal).toHaveBeenCalledWith('signup');
    const browse = getByTestId('landing-cta-browse');
    expect(browse.textContent).toContain('landing_cta_browse');
    expect(browse.getAttribute('href')).toBe('/discover');
  });

  it('sits on the theme hero colour, not on a photo', () => {
    state.config.ui = { landingHeroImage: '/hero.jpg' };
    const { getByTestId, container } = render(LandingHero);
    expect(getByTestId('landing-hero').getAttribute('style')).toContain('--c-hero-2');
    expect(container.querySelector('img')).toBeNull();
  });

  it('without content there is no collage and the text takes the full width', () => {
    const { queryByTestId, getByTestId } = render(LandingHero);
    expect(queryByTestId('landing-collage')).toBeNull();
    expect(getByTestId('landing-hero-grid').className).not.toContain('lg:grid-cols-2');
  });

  it('renders only the cards it gets', () => {
    const { getByTestId, queryByTestId } = render(LandingHero, { props: { nextEvent } });
    expect(getByTestId('landing-collage')).toBeTruthy();
    expect(getByTestId('landing-card-event').textContent).toContain('KI im Religionsunterricht');
    expect(queryByTestId('landing-card-material')).toBeNull();
    expect(queryByTestId('landing-card-article')).toBeNull();
    expect(queryByTestId('landing-card-community')).toBeNull();
  });

  it('cards link to their detail pages', () => {
    const community = { pubkey: PK, name: 'rpi-virtuell', about: 'Religion', picture: '' };
    const { getByTestId } = render(LandingHero, { props: { heroMaterial: material, community } });
    expect(getByTestId('landing-card-material').getAttribute('href')).toMatch(/^\/naddr1/);
    expect(getByTestId('landing-card-material').textContent).toContain('CC BY 4.0');
    expect(getByTestId('landing-card-community').getAttribute('href')).toMatch(/^\/c\/npub1/);
  });

  it('network line links to the help URL', () => {
    const { getByTestId } = render(LandingHero);
    expect(getByTestId('landing-network-line').textContent).toContain(
      'landing_network_line:{"appName":"Finder"}'
    );
    expect(getByTestId('landing-network-link').getAttribute('href')).toBe(
      '/wiki/edufeed-erste-schritte'
    );
  });

  it('network line without help link', () => {
    state.config.help = { url: null };
    const { getByTestId, queryByTestId } = render(LandingHero);
    expect(getByTestId('landing-network-line')).toBeTruthy();
    expect(queryByTestId('landing-network-link')).toBeNull();
  });
});
