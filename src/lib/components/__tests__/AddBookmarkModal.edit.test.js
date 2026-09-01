/**
 * AddBookmarkModal edit-mode tests.
 *
 * Kind 39701 is addressable, so editing means republishing under the same
 * d-tag. The modal therefore prefills from the existing event, locks the
 * address field, and republishes instead of creating a second bookmark.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';

vi.hoisted(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    // @ts-ignore
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {}
    });
  }
});

/** @type {{ modalProps: any, publishSpy: any, signSpy: any, closeSpy: any }} */
const spies = vi.hoisted(() => ({
  modalProps: null,
  publishSpy: null,
  signSpy: null,
  closeSpy: null
}));

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: {
    get modalProps() {
      return spies.modalProps;
    },
    closeModal: (/** @type {any[]} */ ...args) => spies.closeSpy(...args)
  }
}));

vi.mock('$lib/components/calendar/CommunitySelector.svelte', async () => {
  const stub = await import('./fixtures/CommunitySelectorStub.svelte');
  return { default: stub.default };
});

vi.mock('$lib/helpers/shareable-communities.svelte.js', () => ({
  useShareableCommunities: () => () => ['community1', 'community2', 'community3']
}));

vi.mock('$lib/stores/share-restrictions.svelte.js', () => ({
  useShareRestrictions: () => () => []
}));

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    active: {
      pubkey: 'me',
      signEvent: (/** @type {any} */ tmpl) => spies.signSpy(tmpl)
    }
  }
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: (/** @type {any[]} */ ...args) => spies.publishSpy(...args)
}));

vi.mock('$lib/loaders/base.js', () => ({
  addressLoader: () => ({ subscribe: () => ({ unsubscribe: () => {} }) })
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { replaceable: () => ({ pipe: () => ({ subscribe: () => {} }) }) },
  pool: { request: () => ({ pipe: () => ({ subscribe: () => {} }) }) }
}));

vi.mock('$lib/helpers/relay-helper.js', async (importOriginal) => ({
  .../** @type {any} */ (await importOriginal()),
  getAllLookupRelays: () => []
}));

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$app/paths', () => ({ resolve: (/** @type {string} */ p) => p }));

import AddBookmarkModal from '$lib/components/bookmarks/AddBookmarkModal.svelte';

/** @type {import('nostr-tools').NostrEvent} */
const existingBookmark = {
  kind: 39701,
  id: 'bookmark-id',
  pubkey: 'me',
  content: 'Why I saved this',
  tags: [
    ['d', 'example.com/article'],
    ['r', 'https://example.com/article'],
    ['title', 'My Article'],
    ['h', 'community1']
  ],
  created_at: 1000000,
  sig: 'sig'
};

/** @returns {HTMLInputElement} */
function urlField() {
  return /** @type {HTMLInputElement} */ (document.getElementById('bookmark-input'));
}

describe('AddBookmarkModal edit mode', () => {
  beforeEach(() => {
    spies.modalProps = { editEvent: existingBookmark };
    spies.closeSpy = vi.fn();
    spies.publishSpy = vi.fn();
    spies.signSpy = vi.fn(async (/** @type {any} */ tmpl) => ({
      ...tmpl,
      id: 'new-id',
      pubkey: 'me',
      sig: 'new-sig'
    }));
    global.fetch = vi.fn(() => Promise.reject(new Error('no network in tests')));
  });

  it('prefills the form from the bookmark being edited', async () => {
    render(AddBookmarkModal);

    await waitFor(() => expect(urlField().value).toBe('https://example.com/article'));
    expect(/** @type {HTMLInputElement} */ (document.getElementById('bookmark-title')).value).toBe(
      'My Article'
    );
    expect(
      /** @type {HTMLTextAreaElement} */ (document.getElementById('bookmark-description')).value
    ).toBe('Why I saved this');
    expect(screen.getByTestId('selected-communities').textContent).toBe('community1');
  });

  it('locks the address field, because the d-tag is derived from it', async () => {
    render(AddBookmarkModal);

    await waitFor(() => expect(urlField().value).toBe('https://example.com/article'));
    // readonly rather than disabled: the address stays legible and selectable.
    expect(urlField().readOnly).toBe(true);
    expect(urlField().disabled).toBe(false);
  });

  it('republishes the bookmark with the edited fields under the original d-tag', async () => {
    render(AddBookmarkModal);

    await waitFor(() => expect(urlField().value).toBe('https://example.com/article'));

    const titleInput = /** @type {HTMLInputElement} */ (document.getElementById('bookmark-title'));
    await fireEvent.input(titleInput, { target: { value: 'A Better Title' } });

    const descInput = /** @type {HTMLTextAreaElement} */ (
      document.getElementById('bookmark-description')
    );
    await fireEvent.input(descInput, { target: { value: 'Updated comment' } });

    await fireEvent.submit(/** @type {HTMLFormElement} */ (document.querySelector('form')));

    await waitFor(() => expect(spies.publishSpy).toHaveBeenCalled());

    const published = spies.publishSpy.mock.calls[0][0];
    expect(published.kind).toBe(39701);
    expect(published.content).toBe('Updated comment');
    expect(published.tags).toContainEqual(['d', 'example.com/article']);
    expect(published.tags).toContainEqual(['r', 'https://example.com/article']);
    expect(published.tags).toContainEqual(['title', 'A Better Title']);
    expect(published.tags.filter((/** @type {string[]} */ t) => t[0] === 'h')).toEqual([
      ['h', 'community1']
    ]);
    expect(spies.closeSpy).toHaveBeenCalled();
  });

  it('does not preselect the context community over the bookmark own h-tags', async () => {
    spies.modalProps = { editEvent: existingBookmark, communityPubkey: 'community3' };
    render(AddBookmarkModal);

    await waitFor(() => expect(urlField().value).toBe('https://example.com/article'));
    expect(screen.getByTestId('selected-communities').textContent).toBe('community1');
  });

  it('hides the page field when editing a PDF bookmark — the address is immutable', async () => {
    spies.modalProps = {
      editEvent: {
        ...existingBookmark,
        tags: [
          ['d', 'example.com/paper.pdf'],
          ['r', 'https://example.com/paper.pdf#page=3'],
          ['title', 'A Paper']
        ]
      }
    };
    render(AddBookmarkModal);

    await waitFor(() => expect(urlField().value).toBe('https://example.com/paper.pdf#page=3'));
    // handleUpdate never applies the page field, so offering it would
    // silently drop the input.
    expect(document.getElementById('bookmark-page')).toBeNull();
  });

  it('still creates a fresh bookmark when no event is being edited', async () => {
    spies.modalProps = { communityPubkey: 'community2' };
    render(AddBookmarkModal);

    await waitFor(() =>
      expect(screen.getByTestId('selected-communities').textContent).toBe('community2')
    );
    expect(urlField().value).toBe('');
    expect(urlField().disabled).toBe(false);
  });
});
