// @ts-nocheck
/**
 * ArticlePreview — an inline `nostr:naddr` article reference is resolved
 * through the EventStore: shown at once when stored, upgraded when it arrives
 * late, and a plain badge (never an error alert) while it is missing.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { BehaviorSubject } from 'rxjs';

const h = vi.hoisted(() => ({ source: null, pointers: [], loads: [] }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    event: (pointer) => {
      h.pointers.push(pointer);
      return h.source;
    }
  }
}));
// The component only falls back to decoding when no `decoded` prop is passed
vi.mock('$lib/helpers/nostrUtils.js', () => ({ decodeNostrIdentifier: () => null }));
// The network side of useReferencedEvent: recorded, never answers
vi.mock('$lib/loaders/referenced-event.js', async () => {
  const { EMPTY } = await import('rxjs');
  return {
    loadReferencedEvent: (pointer, options) => {
      h.loads.push([pointer, options]);
      return EMPTY;
    }
  };
});
vi.mock('$lib/helpers/relay-helper.js', () => ({
  getAllLookupRelays: () => ['wss://lookup.example/']
}));
vi.mock('$app/paths', () => ({ resolve: (p) => p }));
vi.mock(
  '$lib/components/shared/ImageWithFallback.svelte',
  () => import('./__mocks__/EmptyStub.svelte')
);

const { default: ArticlePreview } = await import(
  '$lib/components/shared/NostrPreviews/ArticlePreview.svelte'
);

const A = 'a'.repeat(64);
const decoded = {
  success: true,
  type: 'naddr',
  data: { kind: 30023, pubkey: A, identifier: 'applesauce-v7', relays: ['wss://hint.example/'] },
  identifier: 'naddr1test'
};
const article = {
  id: 'e'.repeat(64),
  kind: 30023,
  pubkey: A,
  created_at: 1,
  content: '',
  sig: '',
  tags: [
    ['d', 'applesauce-v7'],
    ['title', 'Migrating to applesauce v7'],
    ['summary', 'What changed']
  ]
};

describe('ArticlePreview', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    h.source = new BehaviorSubject(undefined);
    h.pointers = [];
    h.loads = [];
  });
  afterEach(() => vi.useRealTimers());

  it('watches the store for the address and loads it from the hint and lookup relays', () => {
    render(ArticlePreview, { identifier: 'naddr1test', decoded });
    expect(h.pointers).toEqual([{ kind: 30023, pubkey: A, identifier: 'applesauce-v7' }]);
    expect(h.loads[0][0]).toEqual({
      kind: 30023,
      pubkey: A,
      identifier: 'applesauce-v7',
      relays: ['wss://hint.example/', 'wss://lookup.example/']
    });
  });

  it('renders the card at once when the store already holds the article', async () => {
    h.source.next(article);
    render(ArticlePreview, { identifier: 'naddr1test', decoded });
    expect(await screen.findByText('Migrating to applesauce v7')).toBeTruthy();
  });

  it('shows a badge, not an error, while the article is missing, and upgrades when it arrives', async () => {
    const { container } = render(ArticlePreview, { identifier: 'naddr1test', decoded });
    expect(container.querySelector('.skeleton')).toBeTruthy();
    vi.advanceTimersByTime(8000);
    await waitFor(() => expect(container.querySelector('.skeleton')).toBeNull());
    expect(container.querySelector('.alert-error')).toBeNull();
    expect(container.querySelector('.badge')).toBeTruthy();
    h.source.next(article);
    expect(await screen.findByText('Migrating to applesauce v7')).toBeTruthy();
  });
});
