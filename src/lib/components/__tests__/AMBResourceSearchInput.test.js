// @ts-nocheck
/**
 * AMBResourceSearchInput component tests.
 *
 * Covers the search-then-pick flow that the guided-wizard Relations step
 * depends on:
 *   - typing ≥ 2 chars drives an ambSearchLoader call and populates the dropdown
 *   - picking a result emits a `{coordinate, pubkey, dTag, relayHint?, event}` ref
 *   - pasting a valid naddr synthesises a "paste" row and resolves via fetchEventById
 *   - `exclude` / `excludeSelf` hide already-linked entries and self-linking
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';

// Hoisted mock state so the vi.mock factories can reference it safely.
const mocks = vi.hoisted(() => ({
  /** @type {((ev: any) => void) | null} */
  nextMock: null,
  /** @type {(() => void) | null} */
  completeMock: null,
  fetchEventByIdMock: vi.fn()
}));

vi.mock('$lib/loaders/amb-search.js', async () => {
  const { Observable } = await import('rxjs');
  return {
    ambSearchLoader: vi.fn(
      () =>
        new Observable((subscriber) => {
          mocks.nextMock = (ev) => subscriber.next(ev);
          mocks.completeMock = () => subscriber.complete();
          return () => {};
        })
    )
  };
});

vi.mock('$lib/helpers/nostrUtils.js', () => ({
  fetchEventById: mocks.fetchEventByIdMock
}));

// Stub formatAMBResource — we don't care about the full card layout in tests,
// we only assert that the resource name reaches the DOM.
vi.mock('$lib/helpers/educational/ambHelpers.js', () => ({
  formatAMBResource: (event) => ({
    id: event.id,
    identifier: event.tags.find((t) => t[0] === 'd')?.[1] ?? '',
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    name: event.tags.find((t) => t[0] === 'name')?.[1] ?? 'Untitled',
    description: '',
    image: null,
    types: [],
    learningResourceTypes: [],
    subjects: [],
    educationalLevels: [],
    keywords: [],
    languages: [],
    license: null,
    isFree: false,
    publishedDate: event.created_at,
    creatorNames: [],
    resourceURLs: [],
    primaryURL: null,
    encodings: [],
    externalUrl: null,
    externalUrls: [],
    tags: event.tags,
    rawEvent: event
  })
}));

vi.mock('$lib/paraglide/runtime.js', () => ({
  getLocale: () => 'de'
}));

vi.mock('$lib/paraglide/messages.js', () => ({
  amb_picker_paste_row_label: () => 'Use pasted address'
}));

// AMBResourceCard has too many transitive dependencies (SKOS, ReactionBar, …)
// and its navigation conflicts with the row click. The picker renders an
// inline row, but this mock shields us from unrelated test churn if the card
// is ever used here.
vi.mock('../educational/AMBResourceCard.svelte', async () => {
  const noop = { default: () => ({ destroy: () => {} }) };
  return noop;
});

import AMBResourceSearchInput from '../educational/AMBResourceSearchInput.svelte';

function buildEvent({
  id = 'ev1',
  pubkey = 'a'.repeat(64),
  dTag = 'intro-ml',
  name = 'Intro to ML'
} = {}) {
  return {
    id,
    pubkey,
    kind: 30142,
    created_at: 1_700_000_000,
    content: '',
    sig: '',
    tags: [
      ['d', dTag],
      ['name', name]
    ]
  };
}

async function flush() {
  // rxjs completion + debounced 300ms search input
  await new Promise((r) => setTimeout(r, 350));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.nextMock = null;
  mocks.completeMock = null;
});

describe('AMBResourceSearchInput', () => {
  it('renders an input', () => {
    const { container } = render(AMBResourceSearchInput, {
      props: { onselect: () => {}, placeholder: 'Search' }
    });
    const input = container.querySelector('input');
    expect(input).toBeTruthy();
    expect(input?.placeholder).toBe('Search');
  });

  it('does not search for inputs shorter than 2 chars', async () => {
    const { ambSearchLoader } = await import('$lib/loaders/amb-search.js');
    const { container } = render(AMBResourceSearchInput, {
      props: { onselect: () => {} }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'a' } });
    await flush();
    expect(ambSearchLoader).not.toHaveBeenCalled();
  });

  it('shows dropdown rows for search results and emits ref on select', async () => {
    const onselect = vi.fn();
    const { container } = render(AMBResourceSearchInput, {
      props: { onselect }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'intro' } });
    // Wait for debounce, then push a result and complete.
    await new Promise((r) => setTimeout(r, 350));
    mocks.nextMock?.(buildEvent({ id: 'ev1', dTag: 'intro-ml', name: 'Intro to ML' }));
    mocks.completeMock?.();
    await new Promise((r) => setTimeout(r, 50));

    const dropdown = container.querySelector('.absolute.z-50');
    expect(dropdown).toBeTruthy();
    expect(dropdown?.textContent).toContain('Intro to ML');

    const button = dropdown?.querySelector('button');
    expect(button).toBeTruthy();
    await fireEvent.click(button);

    expect(onselect).toHaveBeenCalledTimes(1);
    const ref = onselect.mock.calls[0][0];
    expect(ref.coordinate).toBe(`30142:${'a'.repeat(64)}:intro-ml`);
    expect(ref.pubkey).toBe('a'.repeat(64));
    expect(ref.dTag).toBe('intro-ml');
    expect(ref.event).toBeTruthy();
  });

  it('emits a full dTag when the event d-tag contains colons (URL)', async () => {
    const pubkey = 'a'.repeat(64);
    const urlDTag = 'https://example.org/a:b/c';
    const onselect = vi.fn();
    const { container } = render(AMBResourceSearchInput, {
      props: { onselect }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'example' } });
    await new Promise((r) => setTimeout(r, 350));
    mocks.nextMock?.(buildEvent({ id: 'ev1', pubkey, dTag: urlDTag, name: 'URL Resource' }));
    mocks.completeMock?.();
    await new Promise((r) => setTimeout(r, 50));

    const button = container.querySelector('.absolute.z-50 button');
    expect(button).toBeTruthy();
    await fireEvent.click(button);

    expect(onselect).toHaveBeenCalledTimes(1);
    const ref = onselect.mock.calls[0][0];
    expect(ref.dTag).toBe(urlDTag);
    expect(ref.coordinate).toBe(`30142:${pubkey}:${urlDTag}`);
  });

  it('excludes already-linked coordinates from the dropdown', async () => {
    const coord = `30142:${'a'.repeat(64)}:intro-ml`;
    const onselect = vi.fn();
    const { container } = render(AMBResourceSearchInput, {
      props: { onselect, exclude: [coord] }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'intro' } });
    await new Promise((r) => setTimeout(r, 350));
    mocks.nextMock?.(buildEvent({ id: 'ev1', dTag: 'intro-ml', name: 'Intro to ML' }));
    mocks.completeMock?.();
    await new Promise((r) => setTimeout(r, 50));

    const dropdown = container.querySelector('.absolute.z-50');
    expect(dropdown).toBeNull();
  });

  it('excludes the self coordinate (excludeSelf) from the dropdown', async () => {
    const coord = `30142:${'a'.repeat(64)}:intro-ml`;
    const onselect = vi.fn();
    const { container } = render(AMBResourceSearchInput, {
      props: { onselect, excludeSelf: coord }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: 'intro' } });
    await new Promise((r) => setTimeout(r, 350));
    mocks.nextMock?.(buildEvent({ id: 'ev1', dTag: 'intro-ml', name: 'Intro to ML' }));
    mocks.completeMock?.();
    await new Promise((r) => setTimeout(r, 50));

    const dropdown = container.querySelector('.absolute.z-50');
    expect(dropdown).toBeNull();
  });

  it('synthesises a paste row when the input is a valid kind:30142 naddr and resolves on select', async () => {
    const pubkey = 'b'.repeat(64);
    const identifier = 'pasted-course';
    const naddr = nip19.naddrEncode({ kind: 30142, pubkey, identifier, relays: [] });

    const resolved = buildEvent({ id: 'ev2', pubkey, dTag: identifier, name: 'Pasted Course' });
    mocks.fetchEventByIdMock.mockResolvedValueOnce(resolved);

    const onselect = vi.fn();
    const { container, getByText } = render(AMBResourceSearchInput, {
      props: { onselect }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: naddr } });
    await new Promise((r) => setTimeout(r, 350));
    // No search results — only the paste row should appear.
    mocks.completeMock?.();
    await new Promise((r) => setTimeout(r, 50));

    expect(getByText('Use pasted address')).toBeTruthy();

    const button = container.querySelector('.absolute.z-50 button');
    await fireEvent.click(button);
    // fetchEventById is async — wait for the promise chain to resolve.
    await new Promise((r) => setTimeout(r, 10));

    expect(mocks.fetchEventByIdMock).toHaveBeenCalledTimes(1);
    expect(onselect).toHaveBeenCalledTimes(1);
    const ref = onselect.mock.calls[0][0];
    expect(ref.coordinate).toBe(`30142:${pubkey}:${identifier}`);
    expect(ref.event).toBe(resolved);
  });

  it('does not add a paste row for a non-30142 naddr', async () => {
    const pubkey = 'b'.repeat(64);
    const naddr = nip19.naddrEncode({ kind: 30023, pubkey, identifier: 'article', relays: [] });

    const { container } = render(AMBResourceSearchInput, {
      props: { onselect: () => {} }
    });
    const input = container.querySelector('input');
    await fireEvent.input(input, { target: { value: naddr } });
    await new Promise((r) => setTimeout(r, 350));
    mocks.completeMock?.();
    await new Promise((r) => setTimeout(r, 50));

    const dropdown = container.querySelector('.absolute.z-50');
    expect(dropdown).toBeNull();
  });
});
