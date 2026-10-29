/** @vitest-environment jsdom */
// The landing's community avatar wall (design 5b) — replaces the dots
// carousel: faces in a grid (a swipe row on phones) plus "start your own".
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const state = vi.hoisted(() => ({ openModal: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));
vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { openModal: (/** @type {any[]} */ ...a) => state.openModal(...a) }
}));
vi.mock('$lib/components/shared/ImageWithFallback.svelte', async () => ({
  default: (await import('./__mocks__/EmptyStub.svelte')).default
}));
vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'landing_wall_title',
      'landing_wall_title_before',
      'landing_wall_word_1',
      'landing_wall_word_2',
      'landing_wall_word_3',
      'landing_wall_word_4',
      'landing_wall_all',
      'landing_wall_create',
      'landing_wall_create_sub'
    ].map((k) => [k, () => k])
  )
);

const { default: CommunityWall } = await import('../landing/CommunityWall.svelte');

const c = (/** @type {string} */ ch, /** @type {string} */ name) => ({
  pubkey: ch.repeat(64),
  name,
  about: '',
  picture: ''
});

describe('CommunityWall', () => {
  beforeEach(() => state.openModal.mockReset());

  it('shows each community linking to its page, plus the create tile', () => {
    const { getByTestId, getAllByTestId } = render(CommunityWall, {
      props: { communities: [c('a', 'rpi-virtuell'), c('b', 'OER-Werkstatt')], loaded: true }
    });
    const items = getAllByTestId('landing-wall-item');
    expect(items.map((i) => i.textContent?.trim())).toEqual(['rpi-virtuell', 'OER-Werkstatt']);
    expect(items[0].getAttribute('href')).toMatch(/^\/c\/npub1/);
    expect(getByTestId('landing-wall-all').getAttribute('href')).toBe('/discover?type=communities');
    // App link grammar: a btn with the chevron icon, not a typed arrow glyph
    expect(getByTestId('landing-wall-all').classList.contains('btn')).toBe(true);
    expect(getByTestId('landing-wall-all').querySelector('svg')).not.toBeNull();
    expect(getByTestId('landing-wall-all').textContent).not.toContain('→');
  });

  it('create tile opens signup', async () => {
    const { getByTestId } = render(CommunityWall, {
      props: { communities: [c('a', 'A')], loaded: true }
    });
    await fireEvent.click(getByTestId('landing-wall-create'));
    expect(state.openModal).toHaveBeenCalledWith('signup');
  });

  it('skeletons while loading', () => {
    const { container } = render(CommunityWall, { props: { communities: [], loaded: false } });
    expect(container.querySelectorAll('.skeleton').length).toBe(6);
  });

  it('nothing at all when loaded and empty', () => {
    const { queryByTestId } = render(CommunityWall, { props: { communities: [], loaded: true } });
    expect(queryByTestId('landing-wall')).toBeNull();
  });

  describe('rotating heading word', () => {
    /** @param {boolean} reduce */
    const motion = (reduce) =>
      vi.stubGlobal('matchMedia', (/** @type {string} */ q) => ({
        matches: reduce && q.includes('reduce'),
        addEventListener() {},
        removeEventListener() {}
      }));
    const props = { communities: [c('a', 'rpi-virtuell')], loaded: true };
    const active = (/** @type {HTMLElement} */ el) =>
      el.querySelector('[data-active="true"]')?.textContent?.trim();

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('keeps one stable accessible title; the rotating words are hidden from AT', () => {
      motion(false);
      const { getByRole } = render(CommunityWall, { props });
      // the accessible name skips aria-hidden content: only the static title
      const heading = getByRole('heading', { level: 2, name: 'landing_wall_title' });
      expect(heading.querySelector('[aria-hidden="true"]')).not.toBeNull();
    });

    it('cycles through the words and wraps around', async () => {
      motion(false);
      const { getByRole } = render(CommunityWall, { props });
      const heading = getByRole('heading', { level: 2 });
      expect(active(heading)).toBe('landing_wall_word_1');
      await vi.advanceTimersByTimeAsync(2800);
      expect(active(heading)).toBe('landing_wall_word_2');
      await vi.advanceTimersByTimeAsync(2800 * 3);
      expect(active(heading)).toBe('landing_wall_word_1');
    });

    it('stands still for people who prefer reduced motion', async () => {
      motion(true);
      const { getByRole } = render(CommunityWall, { props });
      await vi.advanceTimersByTimeAsync(2800 * 2);
      expect(active(getByRole('heading', { level: 2 }))).toBe('landing_wall_word_1');
    });
  });
});
