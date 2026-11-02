// @ts-nocheck
/* eslint-disable no-undef -- $effect / $state are Svelte runes, available in .svelte.js context */
/** @vitest-environment jsdom */
/**
 * useAuthorContent(getAuthors, { showsType }) — fetch the content of the
 * people /discover is looking for (members a search matched, authors in the
 * author filter) for the shown types from each type's app relays, once per
 * author, so it shows even when it was never in the loaded feed window.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushSync } from 'svelte';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

const loaders = vi.hoisted(() => ({ fetchEvents: vi.fn(), unsubscribed: 0 }));
vi.mock('$lib/loaders/base.js', () => ({ fetchEvents: loaders.fetchEvents }));
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getArticleRelays: () => ['wss://longform'],
  getEducationalRelays: () => ['wss://amb'],
  getCalendarRelays: () => ['wss://cal'],
  getKanbanRelays: () => ['wss://kanban']
}));

const { useAuthorContent } = await import('$lib/stores/author-content.svelte.js');

describe('useAuthorContent', () => {
  let cleanup;

  beforeEach(() => {
    loaders.unsubscribed = 0;
    loaders.fetchEvents.mockReset();
    loaders.fetchEvents.mockImplementation(() => ({
      subscribe: () => ({ unsubscribe: () => loaders.unsubscribed++ })
    }));
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
  });

  function mount(initial, showsType = () => true) {
    let authors = $state(initial);
    cleanup = $effect.root(() => {
      useAuthorContent(() => authors, { showsType });
    });
    flushSync();
    return (next) => {
      authors = next;
      flushSync();
    };
  }

  const calls = () =>
    loaders.fetchEvents.mock.calls.map(([relays, filter]) => [
      relays[0],
      filter.kinds,
      filter.authors
    ]);

  it('fetches each shown type of the matched members from that type’s relays', () => {
    mount([A], (type) => type !== 'boards');
    expect(calls()).toEqual([
      ['wss://cal', [31922, 31923], [A]],
      ['wss://amb', [30142], [A]],
      ['wss://longform', [30023], [A]]
    ]);
  });

  it('asks for a member only once, however often the match changes', () => {
    const set = mount([A]);
    loaders.fetchEvents.mockClear();
    set([]);
    set([A, B]);
    expect(calls().every(([, , authors]) => authors.length === 1 && authors[0] === B)).toBe(true);
    expect(calls()).toHaveLength(4);
  });

  it('does nothing without matched members', () => {
    mount([]);
    expect(loaders.fetchEvents).not.toHaveBeenCalled();
  });

  it('keeps requests running while the match changes and ends them with the owner', () => {
    const set = mount([A]);
    set([]);
    expect(loaders.unsubscribed).toBe(0);
    cleanup();
    cleanup = undefined;
    expect(loaders.unsubscribed).toBe(4);
  });
});
