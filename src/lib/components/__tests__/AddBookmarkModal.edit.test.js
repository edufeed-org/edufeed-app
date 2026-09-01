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

/** @type {{ modalProps: any, publishSpy: any, signSpy: any, closeSpy: any, deleteSpy: any }} */
const spies = vi.hoisted(() => ({
  modalProps: null,
  publishSpy: null,
  signSpy: null,
  closeSpy: null,
  deleteSpy: null
}));

vi.mock('$lib/helpers/eventDeletion.js', () => ({
  deleteEvent: (/** @type {any[]} */ ...args) => spies.deleteSpy(...args)
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
    spies.deleteSpy = vi.fn(async () => ({ success: true }));
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

  it('shows the page field prefilled when editing a PDF bookmark', async () => {
    spies.modalProps = {
      editEvent: {
        ...existingBookmark,
        tags: [
          ['d', 'example.com/paper.pdf#page=3'],
          ['r', 'https://example.com/paper.pdf#page=3'],
          ['title', 'A Paper'],
          ['h', 'community1']
        ]
      }
    };
    render(AddBookmarkModal);

    await waitFor(() => expect(urlField().value).toBe('https://example.com/paper.pdf#page=3'));
    const pageField = /** @type {HTMLInputElement} */ (document.getElementById('bookmark-page'));
    expect(pageField).not.toBeNull();
    expect(pageField.value).toBe('3');
  });

  it('changing the page MOVES the bookmark: new address published, old event deleted', async () => {
    spies.modalProps = {
      editEvent: {
        ...existingBookmark,
        tags: [
          ['d', 'example.com/paper.pdf#page=3'],
          ['r', 'https://example.com/paper.pdf#page=3'],
          ['title', 'A Paper'],
          ['h', 'community1']
        ]
      }
    };
    render(AddBookmarkModal);
    await waitFor(() => expect(urlField().value).toBe('https://example.com/paper.pdf#page=3'));

    const pageField = /** @type {HTMLInputElement} */ (document.getElementById('bookmark-page'));
    await fireEvent.input(pageField, { target: { value: '31' } });
    await fireEvent.submit(/** @type {HTMLFormElement} */ (document.querySelector('form')));

    await waitFor(() => expect(spies.publishSpy).toHaveBeenCalled());
    const published = spies.publishSpy.mock.calls[0][0];
    // A changed #page fragment is a different NIP-B0 address, so the edit
    // publishes under the new d and deletes the old event.
    expect(published.tags).toContainEqual(['d', 'example.com/paper.pdf#page=31']);
    expect(published.tags).toContainEqual(['r', 'https://example.com/paper.pdf#page=31']);
    expect(spies.deleteSpy).toHaveBeenCalledTimes(1);
    expect(spies.deleteSpy.mock.calls[0][0].id).toBe('bookmark-id');
    expect(spies.closeSpy).toHaveBeenCalled();
  });

  it('an unchanged page keeps the edit an in-place replace — nothing deleted', async () => {
    spies.modalProps = {
      editEvent: {
        ...existingBookmark,
        tags: [
          ['d', 'example.com/paper.pdf#page=3'],
          ['r', 'https://example.com/paper.pdf#page=3'],
          ['title', 'A Paper'],
          ['h', 'community1']
        ]
      }
    };
    render(AddBookmarkModal);
    await waitFor(() => expect(urlField().value).toBe('https://example.com/paper.pdf#page=3'));

    await fireEvent.submit(/** @type {HTMLFormElement} */ (document.querySelector('form')));

    await waitFor(() => expect(spies.publishSpy).toHaveBeenCalled());
    expect(spies.publishSpy.mock.calls[0][0].tags).toContainEqual([
      'd',
      'example.com/paper.pdf#page=3'
    ]);
    expect(spies.deleteSpy).not.toHaveBeenCalled();
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
