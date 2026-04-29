// @ts-nocheck
/**
 * CommentInput preview/write toggle tests.
 *
 * Pins the contract that:
 *   - The textarea is shown by default (Write tab active).
 *   - Clicking Preview swaps in a NAST-rendered preview pane.
 *   - Toggling back to Write preserves the typed content.
 *   - The placeholder shows when previewing empty content.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import CommentInput from '../comments/CommentInput.svelte';

// --- Mocks ---

vi.mock('$lib/paraglide/messages', () => ({
  article_editor_tab_write: () => 'Write',
  article_editor_tab_preview: () => 'Preview',
  comments_input_post_button: () => 'Post',
  comments_input_posting: () => 'Posting…',
  comments_input_cancel_button: () => 'Cancel',
  comments_input_generic_error: () => 'Error posting comment'
}));

vi.mock('$lib/helpers/event-factory.js', () => ({
  createAppEventFactory: vi.fn(() => ({
    create: vi.fn(),
    sign: vi.fn()
  }))
}));

vi.mock('applesauce-common/blueprints', () => ({
  CommentBlueprint: vi.fn()
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEventOptimistic: vi.fn()
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() }
}));

// NostrIdentifier (used by NostrContentRenderer for mentions) pulls in stores
// and loaders we don't need for these tests. Stub it.
vi.mock('$lib/components/shared/NostrIdentifier.svelte', () => ({
  default: vi.fn()
}));

vi.mock('$lib/helpers/image-proxy.js', () => ({
  getProxiedImageUrl: (/** @type {string} */ url) => url
}));

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
