/**
 * CommentInput unit tests focused on URL-rooted (page-note) parent handling.
 *
 * Verifies that when `rootUrl` is provided and there is no `parentItem`,
 * the factory is invoked with a CommentExternalPointer so applesauce-common's
 * setParent operation emits NIP-22-compliant ["I", url] + ["K", "web"] root
 * tags (and matching lowercase "i"/"k" parent tags for top-level posts).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const createMock = vi.fn(async () => ({ tags: [] }));
const signMock = vi.fn(async (/** @type {any} */ draft) => ({
  ...draft,
  id: 'signed-id',
  pubkey: 'me',
  created_at: 1700000000,
  sig: 'sig'
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: () => ({
    create: createMock,
    sign: signMock
  })
}));

vi.mock('applesauce-common/blueprints', () => ({
  CommentBlueprint: { __id: 'CommentBlueprint' }
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: vi.fn()
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() }
}));

vi.mock('$lib/paraglide/messages', () => ({
  comments_input_generic_error: () => 'error',
  comments_input_cancel_button: () => 'Cancel',
  comments_input_post_button: () => 'Post',
  comments_input_posting: () => 'Posting…'
}));

import CommentInput from '../comments/CommentInput.svelte';

const activeUser = { signer: {}, pubkey: 'me' };

describe('CommentInput URL-rooted (page note) posting', () => {
  beforeEach(() => {
    createMock.mockClear();
    signMock.mockClear();
  });

  it('passes a CommentExternalPointer when rootUrl is set and parentItem is null', async () => {
    const url = 'https://example.com/article';
    const { getByTestId } = render(CommentInput, {
      props: { rootUrl: url, parentItem: null, activeUser }
    });

    const textarea = /** @type {HTMLTextAreaElement} */ (getByTestId('comment-input'));
    await fireEvent.input(textarea, { target: { value: 'hello world' } });
    await fireEvent.submit(/** @type {HTMLFormElement} */ (textarea.closest('form')));

    expect(createMock).toHaveBeenCalledOnce();
    const [blueprint, parent, content] = /** @type {any[]} */ (createMock.mock.calls[0]);
    expect(blueprint).toMatchObject({ __id: 'CommentBlueprint' });
    expect(parent).toEqual({ type: 'external', identifier: url, kind: 'web' });
    expect(content).toBe('hello world');
  });

  it('passes the parent comment event when parentItem is provided (reply path)', async () => {
    const url = 'https://example.com/article';
    const parentItem = {
      id: 'page-note-1',
      kind: 1111,
      pubkey: 'p1',
      tags: [
        ['I', url],
        ['K', 'web']
      ],
      created_at: 1700000000,
      content: 'top-level note'
    };

    const { getByTestId } = render(CommentInput, {
      props: { rootUrl: url, parentItem, activeUser }
    });

    const textarea = /** @type {HTMLTextAreaElement} */ (getByTestId('comment-input'));
    await fireEvent.input(textarea, { target: { value: 'reply' } });
    await fireEvent.submit(/** @type {HTMLFormElement} */ (textarea.closest('form')));

    expect(createMock).toHaveBeenCalledOnce();
    const [, parent] = /** @type {any[]} */ (createMock.mock.calls[0]);
    expect(parent).toBe(parentItem);
  });

  it('still uses rootEvent path when no rootUrl is provided (back-compat)', async () => {
    const rootEvent = {
      id: 'evt1',
      kind: 30142,
      pubkey: 'p1',
      tags: [['d', 'res-1']],
      created_at: 1700000000,
      content: ''
    };

    const { getByTestId } = render(CommentInput, {
      props: { rootEvent, parentItem: null, activeUser }
    });

    const textarea = /** @type {HTMLTextAreaElement} */ (getByTestId('comment-input'));
    await fireEvent.input(textarea, { target: { value: 'hi' } });
    await fireEvent.submit(/** @type {HTMLFormElement} */ (textarea.closest('form')));

    expect(createMock).toHaveBeenCalledOnce();
    const [, parent] = /** @type {any[]} */ (createMock.mock.calls[0]);
    expect(parent).toBe(rootEvent);
  });
});
