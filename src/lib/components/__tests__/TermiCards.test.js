/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const BLOCKED = 'b'.repeat(64);
const HIDDEN = 'h'.repeat(64);
const PK = 'a'.repeat(64);
const settings = vi.hoisted(() => ({ showHiddenCalendarSources: false }));

vi.mock('$lib/services/blocked-authors.svelte.js', () => ({
  isBlockedAuthor: (/** @type {string} */ pk) => pk === 'b'.repeat(64)
}));
vi.mock('$lib/services/calendar-sources.svelte.js', () => ({
  isHiddenCalendarSource: (/** @type {string} */ pk) => pk === 'h'.repeat(64)
}));
vi.mock('$lib/stores/app-settings.svelte.js', () => ({ appSettings: settings }));

import ItemCards from '$lib/components/assistant/cards/ItemCards.svelte';
import SourcesNote from '$lib/components/assistant/cards/SourcesNote.svelte';

const LONG_TITLE = 'T'.repeat(200);
const LONG_LINE = 'Ein sehr langer Satz ohne Ende '.repeat(10);

/** @param {any[]} items @param {Record<string, any>} [rest] */
const renderCards = (items, rest = {}) => render(ItemCards, { props: { items, ...rest } });

/** @param {HTMLElement} el */
const buttons = (el) =>
  /** @type {HTMLElement[]} */ ([...el.querySelectorAll('a.btn, button.btn')]);

describe('Termi result cards', () => {
  beforeEach(() => {
    settings.showHiddenCalendarSources = false;
  });

  it('resource: title, type chip, publisher/creator, license, Öffnen in-app + Quelle external', () => {
    const view = renderCards([
      {
        type: 'resource',
        id: `30142:${PK}:x`,
        title: 'Brüche verstehen',
        subtitle: 'Arbeitsblatt',
        creator: 'Ada',
        publisher: 'OERinfo',
        license: 'CC BY 4.0',
        href: '/naddr1abc',
        sourceUrl: 'https://example.org/page'
      }
    ]);
    const card = view.getByTestId('termi-card-resource');
    for (const t of ['Brüche verstehen', 'Arbeitsblatt', 'Ada', 'OERinfo', 'CC BY 4.0'])
      expect(card.textContent).toContain(t);
    const open = view.getByText(m.termi_card_open());
    expect(open.getAttribute('href')).toBe('/naddr1abc');
    expect(open.getAttribute('target')).toBeNull();
    const src = view.getByText(m.termi_card_source());
    expect(src.getAttribute('href')).toBe('https://example.org/page');
    expect(src.getAttribute('target')).toBe('_blank');
    expect(src.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('event: title, DD.MM.YYYY + time, location, author → Öffnen; bot events marked imported', () => {
    const view = renderCards([
      {
        type: 'event',
        id: `31923:${PK}:e1`,
        title: 'Fortbildung OER',
        date: '1794560400',
        location: 'Oldenburg',
        creator: 'Bildungsserver',
        bot: true,
        href: '/naddr1ev'
      },
      {
        type: 'event',
        id: `31922:${PK}:e2`,
        title: 'Ganztags',
        date: '2026-11-20',
        allDay: true,
        href: '/naddr1ev2'
      }
    ]);
    const [timed, allDay] = view.getAllByTestId('termi-card-event');
    expect(timed.textContent).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(timed.textContent).toMatch(/\d{2}:\d{2}/);
    expect(timed.textContent).toContain('Oldenburg');
    expect(timed.textContent).toContain('Bildungsserver');
    expect(timed.textContent).toContain(m.termi_card_imported());
    expect(timed.className).toContain('opacity-');
    expect(allDay.textContent).toContain('20.11.2026');
    expect(allDay.textContent).not.toMatch(/\d{2}:\d{2}/);
    expect(allDay.textContent).not.toContain(m.termi_card_imported());
    expect(timed.querySelector('a')?.getAttribute('href')).toBe('/naddr1ev');
  });

  it('community: picture, name, description → Öffnen', () => {
    const view = renderCards([
      {
        type: 'community',
        id: PK,
        title: 'e-teaching.org',
        description: 'Wissen rund ums digitale Lehren',
        picture: 'https://example.org/c.png',
        href: '/c/npub1abc'
      }
    ]);
    const card = view.getByTestId('termi-card-community');
    expect(card.textContent).toContain('Wissen rund ums digitale Lehren');
    expect(card.querySelector('img')?.getAttribute('src')).toBe('https://example.org/c.png');
    expect(view.getByText(m.termi_card_open()).getAttribute('href')).toBe('/c/npub1abc');
  });

  it('person: avatar, name, nip05 → Profil + "Material von …" calls onSearchAuthor', async () => {
    const onSearchAuthor = vi.fn();
    const view = renderCards(
      [
        {
          type: 'person',
          id: PK,
          title: 'Ada Lovelace',
          subtitle: 'ada@edufeed.org',
          description: 'Mathematikerin',
          picture: 'https://example.org/a.png',
          href: '/p/npub1ada'
        }
      ],
      { onSearchAuthor }
    );
    const card = view.getByTestId('termi-card-person');
    expect(card.textContent).toContain('ada@edufeed.org');
    expect(card.textContent).toContain('Mathematikerin');
    expect(view.getByText(m.termi_card_profile()).getAttribute('href')).toBe('/p/npub1ada');
    await fireEvent.click(view.getByText(m.termi_card_author_search({ name: 'Ada Lovelace' })));
    expect(onSearchAuthor).toHaveBeenCalledWith('Ada Lovelace');
  });

  it('passage: quoted text clamped with mehr/weniger, source, publisher, license → Quelle öffnen', async () => {
    const view = renderCards([
      {
        type: 'passage',
        id: 'chunk1',
        title: 'OER-Handbuch',
        description: LONG_LINE,
        publisher: 'OERinfo',
        license: 'CC BY-SA 4.0',
        href: 'https://example.org/p',
        sourceUrl: 'https://example.org/p'
      }
    ]);
    const card = view.getByTestId('termi-card-passage');
    for (const t of ['OER-Handbuch', 'OERinfo', 'CC BY-SA 4.0'])
      expect(card.textContent).toContain(t);
    const quote = /** @type {HTMLElement} */ (card.querySelector('blockquote'));
    expect(quote.className).toContain('line-clamp-3');
    await fireEvent.click(view.getByText(m.termi_card_more()));
    expect(quote.className).not.toContain('line-clamp-3');
    expect(view.getByText(m.termi_card_less())).toBeTruthy();
    const open = view.getByText(m.termi_card_open_source());
    expect(open.getAttribute('href')).toBe('https://example.org/p');
    expect(open.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('overflow: titles truncate inside min-w-0, buttons wrap and never nowrap', () => {
    const view = renderCards([
      {
        type: 'resource',
        id: `30142:${PK}:l`,
        title: LONG_TITLE,
        description: LONG_LINE,
        href: '/naddr1l',
        sourceUrl: 'https://example.org'
      },
      {
        type: 'event',
        id: `31923:${PK}:l`,
        title: LONG_TITLE,
        location: LONG_LINE,
        href: '/naddr1e'
      },
      { type: 'community', id: PK, title: LONG_TITLE, description: LONG_LINE, href: '/c/npub1x' },
      { type: 'person', id: 'name:x', title: LONG_TITLE, description: LONG_LINE },
      {
        type: 'passage',
        id: 'c',
        title: LONG_TITLE,
        description: LONG_LINE,
        href: 'https://example.org/p'
      }
    ]);
    const titles = view.getAllByTestId('termi-card-title');
    expect(titles).toHaveLength(5);
    for (const t of titles) {
      expect(t.className).toMatch(/truncate|line-clamp-2/);
      expect(t.closest('.min-w-0')).toBeTruthy();
    }
    for (const b of buttons(view.container)) {
      expect(b.className).not.toContain('whitespace-nowrap');
      expect(b.className).toContain('btn-sm');
      expect(b.parentElement?.className).toContain('flex-wrap');
    }
    expect(view.container.innerHTML).not.toContain('whitespace-nowrap');
  });

  it('javascript: and //host links are never rendered', () => {
    const view = renderCards([
      {
        type: 'resource',
        id: `30142:${PK}:j`,
        title: 'Script',
        href: 'javascript:alert(1)',
        sourceUrl: 'javascript:x'
      },
      { type: 'resource', id: `30142:${PK}:p`, title: 'Proto', href: '//evil.example/x' },
      { type: 'passage', id: 'p', title: 'Passage', href: 'data:text/html,x' }
    ]);
    const html = view.container.innerHTML;
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('//evil.example');
    expect(html).not.toContain('data:text');
  });

  it('drops blocked authors (person by id, resource/event by address pubkey)', () => {
    const view = renderCards([
      { type: 'person', id: BLOCKED, title: 'Spam Person', href: '/p/npub1s' },
      { type: 'resource', id: `30142:${BLOCKED}:x`, title: 'Spam Material', href: '/naddr1s' },
      { type: 'resource', id: `30142:${PK}:ok`, title: 'Gutes Material', href: '/naddr1ok' }
    ]);
    expect(view.queryByText('Spam Person')).toBeNull();
    expect(view.queryByText('Spam Material')).toBeNull();
    expect(view.getByText('Gutes Material')).toBeTruthy();
  });

  it('hidden calendar sources: hidden by default, shown with the setting', () => {
    const items = [
      { type: 'event', id: `31923:${HIDDEN}:m`, title: 'Gespiegelt', href: '/naddr1m' },
      { type: 'event', id: `31923:${PK}:o`, title: 'Eigen', href: '/naddr1o' }
    ];
    const hidden = renderCards(items);
    expect(hidden.queryByText('Gespiegelt')).toBeNull();
    expect(hidden.getByText('Eigen')).toBeTruthy();
    hidden.unmount();
    settings.showHiddenCalendarSources = true;
    const shown = renderCards(items);
    expect(shown.getByText('Gespiegelt')).toBeTruthy();
  });

  it('duplicate type+id → one card; untitled items are skipped', () => {
    const view = renderCards([
      { type: 'resource', id: `30142:${PK}:d`, title: 'Doppelt', href: '/naddr1d' },
      { type: 'resource', id: `30142:${PK}:d`, title: 'Doppelt', href: '/naddr1d' },
      { type: 'resource', id: `30142:${PK}:e`, title: '', href: '/naddr1e' }
    ]);
    expect(view.getAllByTestId('termi-card-resource')).toHaveLength(1);
  });

  it('ItemCards shows the sources note with its retry', async () => {
    const onRetry = vi.fn();
    const view = renderCards([], { sourcesUnavailable: ['search_events'], onRetry });
    expect(view.getByText(m.termi_sources_events())).toBeTruthy();
    await fireEvent.click(view.getByText(m.termi_sources_retry()));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe('SourcesNote', () => {
  it('maps tool names to source lines, unknown ones to one generic line', () => {
    const view = render(SourcesNote, {
      props: {
        sources: ['search_events', 'search_content', 'oersi', 'wss://x/'],
        onRetry: () => {}
      }
    });
    expect(view.getByText(m.termi_sources_events())).toBeTruthy();
    expect(view.getByText(m.termi_sources_content())).toBeTruthy();
    expect(view.getAllByText(m.termi_sources_generic())).toHaveLength(1);
  });

  it('renders nothing for no sources; no retry button without a callback', () => {
    const empty = render(SourcesNote, { props: { sources: [] } });
    expect(empty.container.textContent?.trim()).toBe('');
    empty.unmount();
    const noRetry = render(SourcesNote, { props: { sources: ['find_people'] } });
    expect(noRetry.getByText(m.termi_sources_people())).toBeTruthy();
    expect(noRetry.queryByText(m.termi_sources_retry())).toBeNull();
  });
});
