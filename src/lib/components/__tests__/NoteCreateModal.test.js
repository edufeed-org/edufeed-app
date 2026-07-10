/** @vitest-environment jsdom */
/**
 * NoteCreateModal Component Tests (issue #36)
 *
 * Kind 1 note composer: textarea + preview tab + paste-a-reference insertion,
 * publish via factory (NoteBlueprint) + publishEvent outbox, optional
 * community h-tag.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';

// jsdom does not implement window.matchMedia; app-settings.svelte.js calls it
// at import-time. Stub it before any module load triggers that path.
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

import NoteCreateModal from '$lib/components/notes/NoteCreateModal.svelte';

const PUBKEY = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
const COMMUNITY = 'c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ff';

/** @type {{ publishSpy: any, signEventSpy: any, closeSpy: any, addSpy: any, activeUser: any }} */
const spies = vi.hoisted(() => ({
  publishSpy: null,
  signEventSpy: null,
  closeSpy: null,
  addSpy: null,
  activeUser: null
}));

vi.mock('$lib/stores/modal.svelte.js', () => ({
  modalStore: { closeModal: (/** @type {any[]} */ ...args) => spies.closeSpy(...args) }
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any[]} */ ...args) => spies.publishSpy(...args)
}));

vi.mock('$lib/stores/accounts.svelte.js', () => ({
  useActiveUser: () => () => spies.activeUser
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: {
    add: (/** @type {any[]} */ ...args) => spies.addSpy(...args),
    getReplaceable: vi.fn().mockReturnValue(null)
  }
}));

vi.mock('$lib/stores/joined-communities-list.svelte.js', () => ({
  useJoinedCommunitiesList: () => () => []
}));

vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

function StubComponent() {}
vi.mock('$lib/components/shared/NostrContentRenderer.svelte', () => ({
  default: StubComponent
}));

const naddr = nip19.naddrEncode({
  kind: 30142,
  pubkey: PUBKEY,
  identifier: 'res-1',
  relays: []
});

describe('NoteCreateModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    spies.publishSpy = vi.fn().mockResolvedValue({ relays: [] });
    spies.signEventSpy = vi.fn(async (/** @type {any} */ template) => ({
      ...template,
      id: 'signed-id',
      sig: 'signed-sig',
      pubkey: PUBKEY
    }));
    spies.closeSpy = vi.fn();
    spies.addSpy = vi.fn();
    spies.activeUser = {
      pubkey: PUBKEY,
      signer: {
        getPublicKey: async () => PUBKEY,
        signEvent: (/** @type {any} */ t) => spies.signEventSpy(t)
      }
    };
  });

  it('disables publish until content is non-empty', async () => {
    render(NoteCreateModal, { props: {} });
    const submit = /** @type {HTMLButtonElement} */ (screen.getByTestId('note-publish-button'));
    expect(submit.disabled).toBe(true);

    const textarea = screen.getByTestId('note-content-input');
    await fireEvent.input(textarea, { target: { value: 'Hello feed' } });
    expect(submit.disabled).toBe(false);

    await fireEvent.input(textarea, { target: { value: '   ' } });
    expect(submit.disabled).toBe(true);
  });

  it('inserts a valid pasted reference into the content as a nostr: URI', async () => {
    render(NoteCreateModal, { props: {} });

    const textarea = /** @type {HTMLTextAreaElement} */ (screen.getByTestId('note-content-input'));
    await fireEvent.input(textarea, { target: { value: 'Check this out' } });

    const refInput = screen.getByTestId('note-reference-input');
    await fireEvent.input(refInput, { target: { value: `nostr:${naddr}` } });
    await fireEvent.click(screen.getByTestId('note-reference-insert'));

    expect(textarea.value).toBe(`Check this out\n\nnostr:${naddr}`);
    expect(/** @type {HTMLInputElement} */ (refInput).value).toBe('');
  });

  it('shows an error for an invalid reference and does not touch content', async () => {
    render(NoteCreateModal, { props: {} });

    const textarea = /** @type {HTMLTextAreaElement} */ (screen.getByTestId('note-content-input'));
    await fireEvent.input(textarea, { target: { value: 'Original' } });

    const refInput = screen.getByTestId('note-reference-input');
    await fireEvent.input(refInput, { target: { value: 'garbage-input' } });
    await fireEvent.click(screen.getByTestId('note-reference-insert'));

    expect(screen.getByTestId('note-reference-error')).toBeTruthy();
    expect(textarea.value).toBe('Original');
  });

  it('switches to the preview tab', async () => {
    render(NoteCreateModal, { props: {} });

    const textarea = screen.getByTestId('note-content-input');
    await fireEvent.input(textarea, { target: { value: 'Preview me' } });

    await fireEvent.click(screen.getByTestId('note-tab-preview'));
    expect(screen.getByTestId('note-preview-pane')).toBeTruthy();
    expect(screen.queryByTestId('note-content-input')).toBeFalsy();

    await fireEvent.click(screen.getByTestId('note-tab-write'));
    expect(screen.getByTestId('note-content-input')).toBeTruthy();
  });

  it('publishes a kind 1 note and closes the modal', async () => {
    render(NoteCreateModal, { props: {} });

    await fireEvent.input(screen.getByTestId('note-content-input'), {
      target: { value: 'Hello feed' }
    });
    await fireEvent.click(screen.getByTestId('note-publish-button'));

    await waitFor(() => {
      expect(spies.publishSpy).toHaveBeenCalledTimes(1);
    });

    const signed = spies.publishSpy.mock.calls[0][0];
    expect(signed.kind).toBe(1);
    expect(signed.content).toBe('Hello feed');
    expect(spies.addSpy).toHaveBeenCalledWith(signed);
    expect(spies.closeSpy).toHaveBeenCalled();
  });

  it('adds the community h-tag when composing with a community', async () => {
    render(NoteCreateModal, { props: { communityPubkey: COMMUNITY } });

    await fireEvent.input(screen.getByTestId('note-content-input'), {
      target: { value: 'Community note' }
    });
    await fireEvent.click(screen.getByTestId('note-publish-button'));

    await waitFor(() => {
      expect(spies.publishSpy).toHaveBeenCalledTimes(1);
    });

    const signed = spies.publishSpy.mock.calls[0][0];
    expect(signed.tags).toContainEqual(['h', COMMUNITY]);
  });

  it('does not add an h-tag without community context', async () => {
    render(NoteCreateModal, { props: {} });

    await fireEvent.input(screen.getByTestId('note-content-input'), {
      target: { value: 'Global note' }
    });
    await fireEvent.click(screen.getByTestId('note-publish-button'));

    await waitFor(() => {
      expect(spies.publishSpy).toHaveBeenCalledTimes(1);
    });

    const signed = spies.publishSpy.mock.calls[0][0];
    expect(signed.tags.some((/** @type {string[]} */ t) => t[0] === 'h')).toBe(false);
  });

  it('shows an error and does not publish when logged out', async () => {
    spies.activeUser = null;
    render(NoteCreateModal, { props: {} });

    await fireEvent.input(screen.getByTestId('note-content-input'), {
      target: { value: 'No login' }
    });
    await fireEvent.click(screen.getByTestId('note-publish-button'));

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(spies.publishSpy).not.toHaveBeenCalled();
  });

  it('surfaces sign errors and re-enables the form', async () => {
    spies.signEventSpy = vi.fn().mockRejectedValue(new Error('sign refused'));
    render(NoteCreateModal, { props: {} });

    await fireEvent.input(screen.getByTestId('note-content-input'), {
      target: { value: 'Will fail' }
    });
    await fireEvent.click(screen.getByTestId('note-publish-button'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('sign refused');
    });
    expect(spies.publishSpy).not.toHaveBeenCalled();
    const submit = /** @type {HTMLButtonElement} */ (screen.getByTestId('note-publish-button'));
    expect(submit.disabled).toBe(false);
  });
});
