/** @vitest-environment jsdom */
// The three live panels under the landing hero (design 5b/5c): real content
// when there is enough, skeletons while loading, nothing for a quiet type —
// except Fortbildungen, which invites the visitor to add the first one.
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
      'landing_panel_material',
      'landing_panel_material_all',
      'landing_panel_events',
      'landing_panel_events_all',
      'landing_panel_events_empty_title',
      'landing_panel_events_empty_body',
      'landing_panel_events_empty_cta',
      'landing_panel_articles',
      'landing_panel_articles_all'
    ].map((k) => [k, () => k])
  )
);

const { default: LandingShowcase } = await import('../landing/LandingShowcase.svelte');

const PK = 'b'.repeat(64);
const mat = (/** @type {string} */ id) => ({
  id,
  kind: 30142,
  pubkey: PK,
  identifier: id,
  name: `Material ${id}`,
  image: null,
  license: { label: 'CC BY 4.0' },
  rawEvent: { kind: 30142, pubkey: PK, tags: [['d', id]], created_at: 1 }
});
const ev = (/** @type {string} */ id) => ({
  id,
  kind: 31923,
  pubkey: PK,
  title: `Termin ${id}`,
  start: 1_800_000_000,
  originalEvent: { kind: 31923, pubkey: PK, tags: [['d', id]], created_at: 1 }
});
const art = (/** @type {string} */ id) => ({
  id,
  kind: 30023,
  pubkey: PK,
  created_at: 1,
  tags: [
    ['d', id],
    ['title', `Beitrag ${id}`]
  ]
});

const ALL = { learning: true, events: true, articles: true };
const SHOW = { learning: 'show', events: 'show', articles: 'show' };
const base = () => ({
  materials: [mat('1'), mat('2')],
  events: [ev('1'), ev('2')],
  articles: [art('1'), art('2')],
  states: { ...SHOW },
  enabled: { ...ALL }
});

describe('LandingShowcase', () => {
  beforeEach(() => state.openModal.mockReset());

  it('shows each panel with its rows and its "all" link', () => {
    const { getByTestId } = render(LandingShowcase, { props: base() });
    expect(getByTestId('landing-panel-learning').textContent).toContain('Material 1');
    expect(getByTestId('landing-panel-events').textContent).toContain('Termin 2');
    expect(getByTestId('landing-panel-articles').textContent).toContain('Beitrag 1');
    expect(getByTestId('landing-panel-learning-all').getAttribute('href')).toBe(
      '/discover?type=learning'
    );
    expect(getByTestId('landing-panel-events-all').getAttribute('href')).toBe('/calendar');
    expect(getByTestId('landing-panel-articles-all').getAttribute('href')).toBe(
      '/discover?type=articles'
    );
  });

  it('rows link to the detail page', () => {
    const { getByTestId } = render(LandingShowcase, { props: base() });
    const row = getByTestId('landing-panel-learning').querySelector('a[href^="/naddr1"]');
    expect(row).toBeTruthy();
  });

  it('shows skeletons while a type is loading', () => {
    const props = base();
    props.states.learning = 'loading';
    const { getByTestId } = render(LandingShowcase, { props });
    expect(getByTestId('landing-panel-learning').querySelectorAll('.skeleton').length).toBe(3);
  });

  it('a quiet material or article type disappears', () => {
    const props = base();
    props.states.learning = 'hide';
    props.states.articles = 'hide';
    const { queryByTestId } = render(LandingShowcase, { props });
    expect(queryByTestId('landing-panel-learning')).toBeNull();
    expect(queryByTestId('landing-panel-articles')).toBeNull();
  });

  it('no upcoming events: an invitation that opens signup', async () => {
    const props = base();
    props.states.events = 'hide';
    const { getByTestId } = render(LandingShowcase, { props });
    const empty = getByTestId('landing-events-empty');
    expect(empty.textContent).toContain('landing_panel_events_empty_title');
    await fireEvent.click(getByTestId('landing-events-empty-cta'));
    expect(state.openModal).toHaveBeenCalledWith('signup');
  });

  it('a disabled type never renders, not even its invitation', () => {
    const props = base();
    props.enabled.events = false;
    props.states.events = 'hide';
    const { queryByTestId } = render(LandingShowcase, { props });
    expect(queryByTestId('landing-panel-events')).toBeNull();
    expect(queryByTestId('landing-events-empty')).toBeNull();
  });

  it('renders nothing when no panel is left', () => {
    const props = base();
    props.states = { learning: 'hide', events: 'hide', articles: 'hide' };
    props.enabled.events = false;
    const { queryByTestId } = render(LandingShowcase, { props });
    expect(queryByTestId('landing-showcase')).toBeNull();
  });
});
