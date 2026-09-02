/** @vitest-environment jsdom */
/**
 * GroupSettingsSheet — Task 8. Admin-only sheet: edit kind-9002 group
 * metadata (name/about/picture/public/open) and delete the group (9008,
 * two-step confirm). Toggle prefill reads the RAW kind-39000 tags, not the
 * applesauce-parsed metadata — that parser reads an older draft's inverse
 * tags (see GroupChat.svelte's comment on `metadataEvent`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// vi.mock factories are hoisted above these consts, so everything the mock
// factories close over must be built via vi.hoisted() to avoid a "Cannot
// access before initialization" TDZ error at hoist time.
const {
  relaySentinel,
  activeUser,
  editTemplateSentinel,
  deleteTemplateSentinel,
  buildEditGroupMetadataTemplate,
  buildDeleteGroupTemplate,
  publishToGroupRelay,
  showToast
} = vi.hoisted(() => {
  const editTemplateSentinel = { __sentinel: 'edit' };
  const deleteTemplateSentinel = { __sentinel: 'delete' };
  return {
    relaySentinel: { __sentinel: 'relay-conn' },
    activeUser: { pubkey: 'a'.repeat(64), signer: {} },
    editTemplateSentinel,
    deleteTemplateSentinel,
    buildEditGroupMetadataTemplate: vi.fn(
      (/** @type {string} */ _id, /** @type {any} */ _meta) => editTemplateSentinel
    ),
    buildDeleteGroupTemplate: vi.fn(() => deleteTemplateSentinel),
    publishToGroupRelay: vi.fn(() => Promise.resolve({ id: 'signed' })),
    showToast: vi.fn()
  };
});

vi.mock('$lib/groups/group-management.js', () => ({
  buildEditGroupMetadataTemplate,
  buildDeleteGroupTemplate,
  publishToGroupRelay
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => relaySentinel) }
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ useActiveUser: () => () => activeUser }));
vi.mock('$lib/helpers/toast', () => ({ showToast }));
vi.mock('$lib/paraglide/messages', () => ({
  groups_settings_title: () => 'Group settings',
  groups_settings_save: () => 'Save changes',
  groups_settings_saved: () => 'Group updated',
  groups_settings_save_failed: () => 'The relay refused the update',
  groups_settings_delete: () => 'Delete group',
  groups_settings_delete_confirm: () =>
    'Really delete this group for everyone? This cannot be undone.',
  groups_settings_deleted: () => 'Group deleted',
  groups_settings_delete_failed: () => 'The relay refused the deletion',
  // Reused from the create-group form; no new keys needed for these labels.
  groups_create_name_label: () => 'Group name',
  groups_create_about_label: () => 'Description (optional)',
  groups_create_picture_label: () => 'Picture URL (optional)',
  groups_create_public_toggle: () => 'Visible to non-members',
  groups_create_open_toggle: () => 'Anyone can join',
  groups_create_hidden_toggle: () => 'Hidden from the channel list',
  groups_settings_hidden_permanent: () => 'Hidden rooms cannot be made visible again.'
}));

const { default: GroupSettingsSheet } = await import(
  '$lib/components/groups/GroupSettingsSheet.svelte'
);

const pointer = { id: 'grp1', relay: 'wss://relay.example/' };
const metadata = { name: 'Bee Chat', about: 'buzzing', picture: 'https://x.example/pic.png' };

/** @param {string[][]} tags */
function eventWithTags(tags) {
  return { kind: 39000, tags: [['d', 'grp1'], ...tags] };
}

/** @param {Record<string, any>} overrides */
function renderSheet(overrides = {}) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  const props = {
    pointer,
    metadata,
    metadataEvent: eventWithTags([['public']]),
    onClose,
    onDeleted,
    ...overrides
  };
  const result = render(GroupSettingsSheet, { props });
  return { ...result, onClose, onDeleted };
}

beforeEach(() => {
  buildEditGroupMetadataTemplate.mockClear();
  buildEditGroupMetadataTemplate.mockReturnValue(editTemplateSentinel);
  buildDeleteGroupTemplate.mockClear();
  buildDeleteGroupTemplate.mockReturnValue(deleteTemplateSentinel);
  publishToGroupRelay.mockClear();
  publishToGroupRelay.mockResolvedValue({ id: 'signed' });
  showToast.mockClear();
});

describe('GroupSettingsSheet prefill', () => {
  it('prefills name/about/picture from metadata, and public/open from the RAW event tags', () => {
    renderSheet({ metadataEvent: eventWithTags([['public']]) });

    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-name')).value).toBe(
      'Bee Chat'
    );
    expect(/** @type {HTMLTextAreaElement} */ (screen.getByTestId('group-edit-about')).value).toBe(
      'buzzing'
    );
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-picture')).value).toBe(
      'https://x.example/pic.png'
    );

    // Openness is the ABSENCE of private/closed (same rule as
    // channel-access.js): no 'private', no 'closed' -> both checked.
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-public')).checked).toBe(
      true
    );
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-open')).checked).toBe(
      true
    );
  });

  // Issue c4f081fb: the pyramid relay's 39000 for a world-open group carries
  // neither 'public' nor 'open' (verified live — just d + restricted).
  // Presence-based prefill showed it unchecked, and a mere description edit
  // then saved ['private']+['closed'], silently privatizing the group.
  it('shows a spec-current world-open 39000 (no marker tags at all) as public + open', () => {
    renderSheet({ metadataEvent: eventWithTags([['restricted']]) });

    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-public')).checked).toBe(
      true
    );
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-open')).checked).toBe(
      true
    );
  });

  it('shows a private group (private + closed tags) as unchecked', () => {
    renderSheet({ metadataEvent: eventWithTags([['private'], ['closed'], ['restricted']]) });

    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-public')).checked).toBe(
      false
    );
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-open')).checked).toBe(
      false
    );
  });

  // Hidden rooms: the fork's 39000 carries a bare `hidden` tag (nip29
  // Group.ToMetadataEvent) — presence-read is correct here, unlike
  // private/closed where the marker may be absent on spec-current events.
  it('shows a hidden room as checked AND disabled — NIP-29 has no un-hide tag', () => {
    renderSheet({ metadataEvent: eventWithTags([['private'], ['closed'], ['hidden']]) });

    const hidden = /** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-hidden'));
    expect(hidden.checked).toBe(true);
    expect(hidden.disabled).toBe(true);
    // The one-way consequence is spelled out.
    expect(screen.getByText('Hidden rooms cannot be made visible again.')).toBeTruthy();
  });

  it('shows a listed room as unchecked and editable', () => {
    renderSheet({ metadataEvent: eventWithTags([['public']]) });

    const hidden = /** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-hidden'));
    expect(hidden.checked).toBe(false);
    expect(hidden.disabled).toBe(false);
  });

  it('handles a null metadata prop without crashing', () => {
    renderSheet({ metadata: null, metadataEvent: eventWithTags([]) });

    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-name')).value).toBe('');
    // No marker tags at all = world-open, per the absence rule.
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-public')).checked).toBe(
      true
    );
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('group-edit-open')).checked).toBe(
      true
    );
  });
});

describe('GroupSettingsSheet save', () => {
  it('publishes one 9002 built from the current (edited) form state, toasts, and closes', async () => {
    const { onClose } = renderSheet({ metadataEvent: eventWithTags([['public']]) });

    await fireEvent.input(screen.getByTestId('group-edit-name'), {
      target: { value: 'Bee Chat Renamed' }
    });
    await fireEvent.click(screen.getByTestId('group-edit-save'));

    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalledTimes(1));
    expect(buildEditGroupMetadataTemplate).toHaveBeenCalledTimes(1);
    expect(buildEditGroupMetadataTemplate).toHaveBeenCalledWith(
      'grp1',
      expect.objectContaining({
        name: 'Bee Chat Renamed',
        isPublic: true,
        isOpen: true
      })
    );
    expect(publishToGroupRelay).toHaveBeenCalledWith(
      relaySentinel,
      editTemplateSentinel,
      activeUser
    );

    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Group updated', 'success'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('preserves an existing parent tag verbatim on save — a 9002 without one DETACHES the group per NIP-29 Subgroups', async () => {
    renderSheet({ metadataEvent: eventWithTags([['public'], ['parent', 'root-1']]) });

    await fireEvent.click(screen.getByTestId('group-edit-save'));

    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalledTimes(1));
    expect(buildEditGroupMetadataTemplate).toHaveBeenCalledWith(
      'grp1',
      expect.objectContaining({ parent: 'root-1' })
    );
  });

  it('ticking the hidden checkbox saves isHidden — hides the room one-way', async () => {
    renderSheet({ metadataEvent: eventWithTags([['private'], ['closed']]) });

    await fireEvent.click(screen.getByTestId('group-edit-hidden'));
    await fireEvent.click(screen.getByTestId('group-edit-save'));

    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalledTimes(1));
    expect(buildEditGroupMetadataTemplate).toHaveBeenCalledWith(
      'grp1',
      expect.objectContaining({ isHidden: true })
    );
  });

  it('re-states isHidden on every save of an already-hidden room — a 9002 without the tag would UN-hide it on spec-literal relays', async () => {
    renderSheet({ metadataEvent: eventWithTags([['private'], ['closed'], ['hidden']]) });

    await fireEvent.input(screen.getByTestId('group-edit-name'), {
      target: { value: 'Renamed' }
    });
    await fireEvent.click(screen.getByTestId('group-edit-save'));

    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalledTimes(1));
    expect(buildEditGroupMetadataTemplate).toHaveBeenCalledWith(
      'grp1',
      expect.objectContaining({ name: 'Renamed', isHidden: true })
    );
  });

  it('saves isHidden false for a listed room left unticked', async () => {
    renderSheet({ metadataEvent: eventWithTags([['public']]) });

    await fireEvent.click(screen.getByTestId('group-edit-save'));

    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalledTimes(1));
    expect(buildEditGroupMetadataTemplate).toHaveBeenCalledWith(
      'grp1',
      expect.objectContaining({ isHidden: false })
    );
  });

  it('passes no parent when the group metadata carries none', async () => {
    renderSheet({ metadataEvent: eventWithTags([['public']]) });

    await fireEvent.click(screen.getByTestId('group-edit-save'));

    await waitFor(() => expect(publishToGroupRelay).toHaveBeenCalledTimes(1));
    expect(buildEditGroupMetadataTemplate.mock.calls[0][1].parent).toBeUndefined();
  });
});

describe('GroupSettingsSheet delete (two-step confirm)', () => {
  it('does not publish a 9008 on the first click; reveals an inline confirm', async () => {
    renderSheet();

    expect(screen.queryByTestId('group-delete-confirm')).toBeNull();
    await fireEvent.click(screen.getByTestId('group-delete'));

    expect(buildDeleteGroupTemplate).not.toHaveBeenCalled();
    expect(publishToGroupRelay).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-delete-confirm')).toBeTruthy();
    expect(
      screen.getByText('Really delete this group for everyone? This cannot be undone.')
    ).toBeTruthy();
  });

  it('confirm click publishes the 9008 and fires onDeleted then onClose', async () => {
    const { onDeleted, onClose } = renderSheet();

    await fireEvent.click(screen.getByTestId('group-delete'));
    await fireEvent.click(screen.getByTestId('group-delete-confirm'));

    await waitFor(() => expect(buildDeleteGroupTemplate).toHaveBeenCalledWith('grp1'));
    await waitFor(() =>
      expect(publishToGroupRelay).toHaveBeenCalledWith(
        relaySentinel,
        deleteTemplateSentinel,
        activeUser
      )
    );
    await waitFor(() => expect(showToast).toHaveBeenCalledWith('Group deleted', 'success'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
    // onDeleted must fire before onClose.
    const deletedOrder = onDeleted.mock.invocationCallOrder[0];
    const closeOrder = onClose.mock.invocationCallOrder[0];
    expect(deletedOrder).toBeLessThan(closeOrder);
  });
});

describe('GroupSettingsSheet error handling', () => {
  it('rejected save shows the save-failed toast and does not close', async () => {
    publishToGroupRelay.mockRejectedValueOnce(new Error('relay says no'));
    const { onClose } = renderSheet();

    await fireEvent.click(screen.getByTestId('group-edit-save'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('The relay refused the update', 'error')
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('rejected delete-confirm shows the delete-failed toast and fires neither onDeleted nor onClose', async () => {
    publishToGroupRelay.mockRejectedValueOnce(new Error('relay says no'));
    const { onDeleted, onClose } = renderSheet();

    await fireEvent.click(screen.getByTestId('group-delete'));
    await fireEvent.click(screen.getByTestId('group-delete-confirm'));

    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('The relay refused the deletion', 'error')
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
