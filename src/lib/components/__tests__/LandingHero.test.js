/** @vitest-environment jsdom */
// Landing hero after the mobile UX round: plain education words, an account
// CTA, three task tiles gated by the deployment's discover types, and one
// line about the open network instead of the protocol pitch.
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
      'landing_hero_title',
      'landing_hero_subtitle',
      'landing_cta_create_account',
      'landing_cta_browse',
      'landing_task_material_title',
      'landing_task_material_sub',
      'landing_task_training_title',
      'landing_task_training_sub',
      'landing_task_community_title',
      'landing_task_community_sub',
      'landing_network_line',
      'landing_network_link'
    ].map((k) => [
      k,
      (/** @type {any} */ params) => (params ? `${k}:${JSON.stringify(params)}` : k)
    ])
  )
);

const { default: LandingHero } = await import('../landing/LandingHero.svelte');

describe('LandingHero', () => {
  beforeEach(() => {
    state.config = {
      appName: 'Finder',
      discover: {
        contentTypes: ['events', 'learning', 'articles', 'boards', 'communities', 'people']
      },
      ui: {},
      help: { url: '/wiki/edufeed-erste-schritte' }
    };
    state.openModal.mockReset();
  });

  it('primary CTA opens signup, browse links to discover', async () => {
    const { getByTestId } = render(LandingHero);
    await fireEvent.click(getByTestId('landing-cta-signup'));
    expect(state.openModal).toHaveBeenCalledWith('signup');
    expect(getByTestId('landing-cta-browse').getAttribute('href')).toBe('/discover');
  });

  it('shows three task tiles with their targets', () => {
    const { getByTestId } = render(LandingHero);
    expect(getByTestId('landing-task-material').getAttribute('href')).toBe(
      '/discover?type=learning'
    );
    expect(getByTestId('landing-task-training').getAttribute('href')).toBe('/calendar');
    expect(getByTestId('landing-task-community').getAttribute('href')).toBe(
      '/discover?type=communities'
    );
  });

  it('hides tiles for disabled discover types', () => {
    state.config.discover.contentTypes = ['events'];
    const { queryByTestId, getByTestId } = render(LandingHero);
    expect(queryByTestId('landing-task-material')).toBeNull();
    expect(queryByTestId('landing-task-community')).toBeNull();
    expect(getByTestId('landing-task-training')).toBeTruthy();
  });

  it('drops the Kanban badge', () => {
    const { container } = render(LandingHero);
    expect(container.querySelector('a[href="/discover?type=boards"]')).toBeNull();
  });

  it('network line links to the help URL', () => {
    const { getByTestId } = render(LandingHero);
    expect(getByTestId('landing-network-line')).toBeTruthy();
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

  it('keeps the hero image', () => {
    state.config.ui = { landingHeroImage: '/hero.jpg' };
    const { container } = render(LandingHero);
    expect(container.querySelector('section')?.className).not.toContain('bg-gradient-to-br');
  });

  it('network line names the deployment and sits on its own scrim', () => {
    const { getByTestId } = render(LandingHero);
    const line = getByTestId('landing-network-line');
    expect(line.textContent).toContain('landing_network_line:{"appName":"Finder"}');
    // White text must not sit directly on a bright hero photo or a light gradient.
    expect(line.className).toMatch(/bg-black\/\d+/);
  });

  it('tile icons are decorative (no English icon names in the German UI)', () => {
    const { getByTestId } = render(LandingHero);
    for (const id of ['material', 'training', 'community']) {
      expect(getByTestId(`landing-task-${id}`).querySelector('[role="img"]:not([aria-hidden="true"])')).toBeNull();
    }
  });
});
