/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import * as m from '$lib/paraglide/messages';
import { overwriteGetLocale } from '$lib/paraglide/runtime.js';

overwriteGetLocale(() => 'de');

const BLOCKED = 'b'.repeat(64);
const HIDDEN = 'h'.repeat(64);
const PK = 'a'.repeat(64);
const settings = vi.hoisted(() => ({ showHiddenCalendarSources: false }));

vi.mock('$lib/services/blocked-authors.svelte.js', async () => {
  const l = await import('./termi-cards-lists.svelte.js');
  return {
    isBlockedAuthor: (/** @type {string} */ pk) => l.blocked.includes(pk),
    getBlockedAuthorsVersion: () => l.versions.blocked
  };
});
vi.mock('$lib/services/calendar-sources.svelte.js', async () => {
  const l = await import('./termi-cards-lists.svelte.js');
  return {
    isHiddenCalendarSource: (/** @type {string} */ pk) => l.hidden.includes(pk),
    getHiddenCalendarSourcesVersion: () => l.versions.hidden
  };
});
vi.mock('$lib/stores/app-settings.svelte.js', () => ({ appSettings: settings }));
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: { discover: { contentTypes: ['learning', 'events', 'people'] } }
}));

import { blocked, hidden, versions } from './termi-cards-lists.svelte.js';
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
    blocked.splice(0, blocked.length, BLOCKED);
    hidden.splice(0, hidden.length, HIDDEN);
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

  it('event dates use dots in the English UI too', () => {
    overwriteGetLocale(() => 'en');
    try {
      const view = renderCards([
        { type: 'event', id: `31923:${PK}:en`, title: 'Talk', date: '1794560400', href: '/naddr1t' }
      ]);
      expect(view.getByTestId('termi-card-event').textContent).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    } finally {
      overwriteGetLocale(() => 'de');
    }
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
    expect(card.querySelector('img')?.getAttribute('src')).toBe(
      `/api/image?url=${encodeURIComponent('https://example.org/c.png')}&w=64&h=64&q=80`
    );
    expect(view.getByText(m.termi_card_open()).getAttribute('href')).toBe('/c/npub1abc');
    expect(view.getByRole('link', { name: `${m.termi_card_open()}: e-teaching.org` })).toBeTruthy();
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
    expect(card.querySelector('img')?.getAttribute('src')).toMatch(/^\/api\/image\?url=https/);
    expect(view.getByText(m.termi_card_profile()).getAttribute('href')).toBe('/p/npub1ada');
    await fireEvent.click(view.getByText(m.termi_card_author_search({ name: 'Ada Lovelace' })));
    expect(onSearchAuthor).toHaveBeenCalledWith(
      expect.objectContaining({ id: PK, title: 'Ada Lovelace' })
    );
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
    const more = view.getByText(m.termi_card_more());
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
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

  it('drops blocked authors: person/community by id, everything else by its pubkey', () => {
    const view = renderCards([
      { type: 'person', id: BLOCKED, title: 'Spam Person', href: '/p/npub1s' },
      {
        type: 'resource',
        id: `30142:${BLOCKED}:x`,
        pubkey: BLOCKED,
        title: 'Spam Material',
        href: '/naddr1s'
      },
      {
        type: 'passage',
        id: 'abc:1',
        pubkey: BLOCKED,
        title: 'Spam Passage',
        href: 'https://example.org/s'
      },
      {
        type: 'resource',
        id: `30142:${PK}:ok`,
        pubkey: PK,
        title: 'Gutes Material',
        href: '/naddr1ok'
      }
    ]);
    expect(view.queryByText('Spam Person')).toBeNull();
    expect(view.queryByText('Spam Material')).toBeNull();
    expect(view.queryByText('Spam Passage')).toBeNull();
    expect(view.getByText('Gutes Material')).toBeTruthy();
  });

  it('a block that resolves after the answer hides the card', async () => {
    blocked.length = 0;
    const view = renderCards([
      {
        type: 'resource',
        id: `30142:${PK}:late`,
        pubkey: PK,
        title: 'Spät gesperrt',
        href: '/naddr1l'
      }
    ]);
    expect(view.getByText('Spät gesperrt')).toBeTruthy();
    blocked.push(PK);
    versions.blocked++;
    await tick();
    expect(view.queryByText('Spät gesperrt')).toBeNull();
  });

  it('"Alle anzeigen": one link per shown, enabled type, topic truncated', () => {
    const topic = 'Bruchrechnung in der Sekundarstufe eins mit vielen Beispielen';
    const view = renderCards(
      [
        { type: 'resource', id: `30142:${PK}:a`, pubkey: PK, title: 'R1', href: '/naddr1a' },
        { type: 'resource', id: `30142:${PK}:b`, pubkey: PK, title: 'R2', href: '/naddr1b' },
        { type: 'event', id: `31923:${PK}:e`, pubkey: PK, title: 'E', href: '/naddr1e' },
        { type: 'community', id: PK, title: 'C', href: '/c/npub1c' },
        { type: 'passage', id: 'x:1', title: 'P', href: 'https://example.org/p' }
      ],
      { query: topic }
    );
    const short = `${topic.slice(0, 39)}…`;
    const links = view.getAllByText(
      (_, el) =>
        /^(Lernmaterialien|Veranstaltungen|Communities|Personen):/.test(el?.textContent ?? '') &&
        el?.tagName === 'A'
    );
    expect(links.map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      [
        m.termi_card_all({ type: m.discover_tab_learning(), topic: short }),
        `/discover?type=learning&search=${encodeURIComponent(topic)}`
      ],
      [
        m.termi_card_all({ type: m.discover_tab_events(), topic: short }),
        `/discover?type=events&search=${encodeURIComponent(topic)}`
      ]
    ]);
  });

  it('no "Alle anzeigen" without a query', () => {
    const view = renderCards([
      { type: 'resource', id: `30142:${PK}:a`, title: 'R1', href: '/naddr1a' }
    ]);
    expect(view.container.querySelectorAll('a').length).toBe(1);
  });

  it('hidden calendar sources: hidden by default, shown with the setting', () => {
    const items = [
      {
        type: 'event',
        id: `31923:${HIDDEN}:m`,
        pubkey: HIDDEN,
        title: 'Gespiegelt',
        href: '/naddr1m'
      },
      { type: 'event', id: `31923:${PK}:o`, pubkey: PK, title: 'Eigen', href: '/naddr1o' }
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
