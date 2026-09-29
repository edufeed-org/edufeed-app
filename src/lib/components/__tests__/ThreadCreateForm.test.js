// @ts-nocheck
/** @vitest-environment jsdom */
/**
 * ThreadCreateForm — the forum thread (kind 11) composer runs on the shared
 * ComposerInput: NIP-27 references in the body become NIP-10 p tags (bare
 * npubs are repaired first), and the mentioned users are handed to the
 * outbox so the thread also lands on their read relays.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';

vi.mock(
  '$lib/stores/mention-candidates.svelte.js',
  () => import('./fixtures/mention-candidates-mock.svelte.js')
);
vi.mock('$lib/stores/profile-map.svelte.js', () => ({ useProfileMap: () => () => new Map() }));
vi.mock('$lib/services/publish-service.js', () => ({ publishEventOptimistic: vi.fn() }));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() },
  pool: { request: vi.fn() }
}));
vi.mock('$lib/helpers/toast.js', () => ({ showToast: vi.fn() }));
vi.mock('$lib/paraglide/messages', async (importOriginal) => ({
  ...(await importOriginal()),
  common_cancel: () => 'Cancel',
  thread_create_add_tag: () => 'Add',
  thread_create_content_label: () => 'Content',
  thread_create_content_placeholder: () => 'Write…',
  thread_create_error: () => 'error',
  thread_create_markdown_hint: () => 'Markdown',
  thread_create_posting: () => 'Creating…',
  thread_create_remove_tag: () => 'Remove',
  thread_create_submit: () => 'Create',
  thread_create_success: () => 'ok',
  thread_create_tags_label: () => 'Tags',
  thread_create_tags_placeholder: () => 'tag',
  thread_create_title: () => 'New thread',
  thread_create_title_label: () => 'Title',
  thread_create_title_placeholder: () => 'Title…'
}));
// The real createAppEventFactory runs (it applies the content operations).

import ThreadCreateForm from '../thread/ThreadCreateForm.svelte';
import { publishEventOptimistic } from '$lib/services/publish-service.js';

const COMMUNITY = 'c'.repeat(64);
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

describe('ThreadCreateForm', () => {
  it('keeps an accessible name on the content editor', () => {
    const { getByTestId } = render(ThreadCreateForm, {
      props: {
        communityPubkey: COMMUNITY,
        activeUser: { pubkey: 'me', signer: {} },
        open: true,
        onclose: () => {}
      }
    });
    const editor = getByTestId('thread-content-input');
    const labelId = editor.getAttribute('aria-labelledby');
    expect(labelId).toBe('thread-content-label');
    expect(document.getElementById(labelId)?.textContent).toBe('Content');
  });

  it('p-tags mentioned users, repairs bare npubs, and passes them to the outbox', async () => {
    const signer = {
      signEvent: vi.fn(async (t) => ({ ...t, id: 'id', pubkey: 'me', sig: 's' }))
    };
    const { getByTestId, getByLabelText } = render(ThreadCreateForm, {
      props: {
        communityPubkey: COMMUNITY,
        activeUser: { pubkey: 'me', signer },
        open: true,
        onclose: () => {}
      }
    });
    await fireEvent.input(getByLabelText('Title'), { target: { value: 'Hello' } });
    const editor = getByTestId('thread-content-input');
    editor.textContent = `hi nostr:${nip19.npubEncode(ALICE)} and ${nip19.npubEncode(BOB)}`;
    await fireEvent.input(editor);
    // the <dialog> carries no `open` attribute in jsdom, so its button is not
    // in the accessibility tree — submit the form itself
    await fireEvent.submit(/** @type {HTMLFormElement} */ (editor.closest('form')));
    await waitFor(() => expect(signer.signEvent).toHaveBeenCalled());
    const template = signer.signEvent.mock.calls[0][0];
    expect(template.kind).toBe(11);
    expect(template.tags).toContainEqual(['p', ALICE]);
    expect(template.tags).toContainEqual(['p', BOB]);
    expect(template.content).toContain(`nostr:${nip19.npubEncode(BOB)}`);
    await waitFor(() => expect(publishEventOptimistic).toHaveBeenCalled());
    expect(publishEventOptimistic.mock.calls[0][1]).toEqual([COMMUNITY, ALICE, BOB]);
  });
});
