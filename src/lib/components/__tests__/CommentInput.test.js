// @ts-nocheck
/**
 * CommentInput tests — covers two independent concerns:
 *
 *  1. Preview/Write toggle (NAST-rendered preview pane).
 *  2. URL-rooted (page-note) parent handling: when `rootUrl` is provided and
 *     there is no `parentItem`, the factory is invoked with a
 *     CommentExternalPointer so applesauce-common's setParent operation emits
 *     NIP-22-compliant ["I", url] + ["K", "web"] root tags (and matching
 *     lowercase "i"/"k" parent tags for top-level posts).
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

// --- Module-level mocks (shared across both describe blocks) ---

const createMock = vi.fn(async () => ({ tags: [] }));
const signMock = vi.fn(async (draft) => ({
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
  article_editor_tab_write: () => 'Write',
  article_editor_tab_preview: () => 'Preview',
  comments_input_post_button: () => 'Post',
  comments_input_posting: () => 'Posting…',
  comments_input_cancel_button: () => 'Cancel',
  comments_input_generic_error: () => 'Error posting comment'
}));

// NostrIdentifier (used by NostrContentRenderer for mentions) pulls in stores
// and loaders we don't need for these tests. Stub it.
vi.mock('$lib/components/shared/NostrIdentifier.svelte', () => ({
  default: vi.fn()
}));

vi.mock('$lib/helpers/image-proxy.js', () => ({
  getProxiedImageUrl: (url) => url
}));

import CommentInput from '../comments/CommentInput.svelte';

// --- Stubs ---

const stubRoot = {
  id: 'root1',
  pubkey: 'p1',
  kind: 1,
  tags: [],
  content: '',
  created_at: 0,
  sig: ''
};
const stubUser = {
  pubkey: 'u1',
  signer: { signEvent: vi.fn() }
};
const activeUser = { signer: {}, pubkey: 'me' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CommentInput preview/write toggle', () => {
  it('renders textarea by default (Write tab active)', () => {
    const { getByTestId, queryByTestId } = render(CommentInput, {
      props: { rootEvent: stubRoot, activeUser: stubUser }
    });
    expect(getByTestId('comment-input')).toBeTruthy();
    expect(queryByTestId('comment-preview')).toBeNull();
  });

  it('switches to preview pane when Preview tab clicked', async () => {
    const { getByTestId, queryByTestId, getByRole } = render(CommentInput, {
      props: { rootEvent: stubRoot, activeUser: stubUser }
    });
    const textarea = getByTestId('comment-input');
    await fireEvent.input(textarea, { target: { value: 'Hello #world' } });

    await fireEvent.click(getByRole('button', { name: 'Preview' }));

    expect(getByTestId('comment-preview')).toBeTruthy();
    expect(queryByTestId('comment-input')).toBeNull();
  });

  it('renders parsed content in the preview pane (URL becomes link)', async () => {
    const { getByTestId, getByRole } = render(CommentInput, {
      props: { rootEvent: stubRoot, activeUser: stubUser }
    });
    const textarea = getByTestId('comment-input');
    await fireEvent.input(textarea, {
      target: { value: 'See https://example.com/page' }
    });

    await fireEvent.click(getByRole('button', { name: 'Preview' }));

    // applesauce-content's default pipeline parses URLs into link nodes →
    // NostrContentRenderer wraps them in <a class="link link-primary">.
    // Asserting the anchor confirms NAST rendering is active (vs raw text echo).
    const preview = getByTestId('comment-preview');
    const link = preview.querySelector('a[href="https://example.com/page"]');
    expect(link).toBeTruthy();
    expect(link?.classList.contains('link-primary')).toBe(true);
  });

  it('preserves content when toggling back to Write', async () => {
    const { getByTestId, getByRole } = render(CommentInput, {
      props: { rootEvent: stubRoot, activeUser: stubUser }
    });
    const textarea = /** @type {HTMLTextAreaElement} */ (getByTestId('comment-input'));
    await fireEvent.input(textarea, { target: { value: 'draft' } });

    await fireEvent.click(getByRole('button', { name: 'Preview' }));
    await fireEvent.click(getByRole('button', { name: 'Write' }));

    const restored = /** @type {HTMLTextAreaElement} */ (getByTestId('comment-input'));
    expect(restored.value).toBe('draft');
  });

  it('shows placeholder when previewing empty content', async () => {
    const { getByText, getByRole } = render(CommentInput, {
      props: { rootEvent: stubRoot, activeUser: stubUser, placeholder: 'Say hi' }
    });
    await fireEvent.click(getByRole('button', { name: 'Preview' }));
    expect(getByText('Say hi')).toBeTruthy();
  });
});

describe('CommentInput URL-rooted (page note) posting', () => {
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
