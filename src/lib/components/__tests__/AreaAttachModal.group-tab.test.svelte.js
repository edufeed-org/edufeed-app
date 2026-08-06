/** @vitest-environment jsdom */
/**
 * AreaAttachModal — the second tab: attach an EXISTING NIP-29 group as a
 * channel of this community (Stufe A3).
 *
 * The pointer parsing and the 10222 rewrite have their own unit tests. What
 * only this test can prove is the wiring: that the tab exists, that what the
 * form collects reaches attachGroupChannel unchanged, and that the modal
 * offers exactly the modes the community may still be extended by.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);
const RELAY = 'wss://groups.example';
// What gets written is the parser's normalised URL, not the typed string —
// channelKey normalises too, so both forms address the same channel.
const RELAY_N = 'wss://groups.example/';

const mockManager = vi.hoisted(() => ({
  active: { pubkey: 'a'.repeat(64) },
  getAccountForPubkey: vi.fn(() => ({ signer: { sign: () => {} } }))
}));
vi.mock('$lib/stores/accounts.svelte', () => ({ manager: mockManager }));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));
vi.mock('$lib/concord/attach.js', () => ({ attachConcordArea: vi.fn() }));
vi.mock('$lib/concord/unlinked-areas.svelte.js', () => ({
  useAttachableConcordAreas: () => () => []
}));

// PARTIAL: this module also exports attachableAreaModes and the template
// builders, which the component and its own unit tests need for real.
const attachGroupChannel = vi.hoisted(() => vi.fn(async (/** @type {any} */ _args) => ({})));
vi.mock('$lib/groups/community-attach.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return { ...actual, attachGroupChannel };
});

import AreaAttachModal from '$lib/components/community/channels/AreaAttachModal.svelte';

/** @param {string[][]} extraTags */
const community = (extraTags = []) => ({
  kind: 10222,
  pubkey: OWNER,
  content: '',
  created_at: 1,
  tags: [['d', 'relilab'], ...extraTags]
});

/** @param {any} props */
function open(props = {}) {
  return render(AreaAttachModal, {
    props: { communikeyEvent: community(), onClose: () => {}, ...props }
  });
}

describe('AreaAttachModal — attaching a NIP-29 group', () => {
  beforeEach(() => {
    attachGroupChannel.mockClear();
  });

  it('offers the group tab and shows its address field', async () => {
    open();
    await fireEvent.click(screen.getByTestId('attach-tab-group'));
    expect(screen.getByTestId('group-attach-input')).toBeTruthy();
  });

  it('passes the parsed pointer and the chosen access marker through', async () => {
    open();
    await fireEvent.click(screen.getByTestId('attach-tab-group'));
    await fireEvent.input(screen.getByTestId('group-attach-input'), {
      target: { value: "groups.example'allgemein" }
    });
    await fireEvent.change(screen.getByTestId('group-attach-access'), {
      target: { value: 'members' }
    });
    await fireEvent.click(screen.getByTestId('group-attach-confirm'));

    expect(attachGroupChannel).toHaveBeenCalledTimes(1);
    const call = attachGroupChannel.mock.calls[0][0];
    expect(call.pointer).toEqual({ id: 'allgemein', relay: RELAY_N, access: 'members' });
    expect(call.communikeyEvent.pubkey).toBe(OWNER);
    expect(call.communitySigner).toBeTruthy();
  });

  // The marker only ever picks a glyph, and overstating openness is the
  // harmful direction — so the lock is what an untouched form produces.
  it('defaults to the closed marker', async () => {
    open();
    await fireEvent.click(screen.getByTestId('attach-tab-group'));
    await fireEvent.input(screen.getByTestId('group-attach-input'), {
      target: { value: "groups.example'leitung" }
    });
    await fireEvent.click(screen.getByTestId('group-attach-confirm'));

    expect(attachGroupChannel.mock.calls[0][0].pointer.access).toBe('invited');
  });

  it('refuses to publish an address it cannot parse, and says so', async () => {
    open();
    await fireEvent.click(screen.getByTestId('attach-tab-group'));
    await fireEvent.input(screen.getByTestId('group-attach-input'), {
      target: { value: 'not a group address' }
    });

    expect(screen.getByTestId('group-attach-error')).toBeTruthy();
    const confirm = /** @type {HTMLButtonElement} */ (screen.getByTestId('group-attach-confirm'));
    expect(confirm.disabled).toBe(true);
    await fireEvent.click(confirm);
    expect(attachGroupChannel).not.toHaveBeenCalled();
  });

  // Silence beats a red field on an untouched form.
  it('says nothing about an empty field', async () => {
    open();
    await fireEvent.click(screen.getByTestId('attach-tab-group'));
    expect(screen.queryByTestId('group-attach-error')).toBeNull();
  });

  it('keeps the confirm button out of reach while the field is empty', async () => {
    open();
    await fireEvent.click(screen.getByTestId('attach-tab-group'));
    expect(
      /** @type {HTMLButtonElement} */ (screen.getByTestId('group-attach-confirm')).disabled
    ).toBe(true);
  });

  // One protected area per community: once one side is taken, the other is
  // not on offer any more.
  it('hides the concord tab once the community already lists a group channel', () => {
    open({ communikeyEvent: community([['group', 'allgemein', RELAY]]) });
    expect(screen.queryByTestId('attach-tab-concord')).toBeNull();
    expect(screen.queryByTestId('group-attach-input')).not.toBeNull();
  });

  it('hides the group tab once the community already has a concord area', () => {
    open({ communikeyEvent: community([['concord', 'c'.repeat(64), 'wss://c.example']]) });
    expect(screen.queryByTestId('attach-tab-group')).toBeNull();
    expect(screen.queryByTestId('group-attach-input')).toBeNull();
  });
});
