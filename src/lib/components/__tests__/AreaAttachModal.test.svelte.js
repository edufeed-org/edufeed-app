/** @vitest-environment jsdom */
/**
 * AreaAttachModal — one unified picker (spec 2026-08-12). The pure logic
 * (candidates, parsing, access-question rule) has its own unit tests; what
 * only this test can prove is the wiring: rows render with category
 * subtitles, the paste path previews before it attaches, the access
 * question appears only for private NIP-29 targets, and the confirm
 * dispatches the right attach call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

const OWNER = 'a'.repeat(64);

const mockManager = vi.hoisted(() => ({
  active: { pubkey: 'a'.repeat(64) },
  getAccountForPubkey: vi.fn(() => ({ signer: { sign: () => {} } }))
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: mockManager,
  accountsMeta: { version: 0 }
}));
vi.mock('$lib/helpers/toast', () => ({ showToast: vi.fn() }));

const attachConcordArea = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('$lib/concord/attach.js', () => ({ attachConcordArea }));

const concordAreas = vi.hoisted(() => ({ value: /** @type {any[]} */ ([]) }));
vi.mock('$lib/concord/unlinked-areas.svelte.js', () => ({
  useAttachableConcordAreas: () => () => concordAreas.value
}));

const myGroups = vi.hoisted(() => ({ value: /** @type {any[]} */ ([]) }));
vi.mock('$lib/groups/unlinked-groups.svelte.js', () => ({
  useMyGroups: () => () => myGroups.value
}));
const channelMeta = vi.hoisted(() => ({ value: /** @type {any} */ ({ byKey: {} }) }));
vi.mock('$lib/groups/channel-metadata.svelte.js', () => ({
  useChannelMetadata: () => () => channelMeta.value
}));

const previewResult = vi.hoisted(() => ({ value: /** @type {any} */ (null) }));
const fetchGroupPreview = vi.hoisted(() => vi.fn(async () => previewResult.value));
vi.mock('$lib/groups/group-preview.js', () => ({ fetchGroupPreview }));
// A bare partial mock (only `pool`) leaves `eventStore` undefined for every
// other importer sharing this module graph (e.g. profile.js) — see
// PrivateChannelsView.group-channels.test.svelte.js for the same gotcha.
vi.mock('$lib/stores/nostr-infrastructure.svelte', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return { ...actual, pool: { relay: vi.fn(() => ({})) } };
});

const attachGroupChannel = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('$lib/groups/community-attach.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return { ...actual, attachGroupChannel };
});

import AreaAttachModal from '$lib/components/community/channels/AreaAttachModal.svelte';

/** A virgin 10222: both modes open. */
const virgin = { kind: 10222, pubkey: OWNER, tags: [] };
const PROPS = { communikeyEvent: virgin, onClose: vi.fn() };

const meta39000 = (/** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', 'book'], ['name', 'Lesekreis'], ...extra]
});

beforeEach(() => {
  vi.clearAllMocks();
  concordAreas.value = [];
  myGroups.value = [];
  channelMeta.value = { byKey: {} };
  previewResult.value = null;
  // clearAllMocks() wipes calls/results but not an implementation swapped in
  // by mockImplementation() (only mockReset()/restoreAllMocks() do that) — a
  // never-resolving fetchGroupPreview from one test would otherwise leak
  // into every test after it.
  fetchGroupPreview.mockImplementation(async () => previewResult.value);
});

describe('AreaAttachModal — unified picker', () => {
  it('renders one list mixing areas and groups with category subtitles, no tabs', () => {
    concordAreas.value = [
      { communityId: 'area-1', name: 'Team intern', relay: 'wss://c', linkedToJoined: false }
    ];
    myGroups.value = [{ id: 'book', relay: 'wss://g.example/' }];
    channelMeta.value = { byKey: { 'book@wss://g.example/': meta39000([['private']]) } };
    render(AreaAttachModal, { props: PROPS });
    const rows = screen.getAllByTestId('attach-candidate');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Encrypted group'),
      expect.stringContaining('Closed group')
    ]);
    expect(screen.queryByTestId('attach-tab-concord')).toBeNull();
    expect(screen.queryByTestId('protocol-notice')).toBeNull();
  });

  it('asks the access question only for a private NIP-29 selection', async () => {
    myGroups.value = [
      { id: 'book', relay: 'wss://g.example/' },
      { id: 'open', relay: 'wss://g.example/' }
    ];
    channelMeta.value = {
      byKey: {
        'book@wss://g.example/': meta39000([['private']]),
        'open@wss://g.example/': {
          kind: 39000,
          tags: [
            ['d', 'open'],
            ['name', 'Offen']
          ]
        }
      }
    };
    render(AreaAttachModal, { props: PROPS });
    const rows = screen.getAllByTestId('attach-candidate');
    // private group -> question with the wizard's radios
    await fireEvent.click(
      /** @type {Element} */ (rows.find((r) => r.textContent?.includes('Lesekreis')))
    );
    expect(screen.getByTestId('attach-access-invited')).toBeTruthy();
    expect(
      /** @type {HTMLInputElement} */ (screen.getByTestId('attach-access-invited')).checked
    ).toBe(true);
    // world-readable group -> no question
    await fireEvent.click(
      /** @type {Element} */ (rows.find((r) => r.textContent?.includes('Offen')))
    );
    expect(screen.queryByTestId('attach-access-invited')).toBeNull();
  });

  it('attaches a picked private group with the chosen access', async () => {
    myGroups.value = [{ id: 'book', relay: 'wss://g.example/' }];
    channelMeta.value = { byKey: { 'book@wss://g.example/': meta39000([['private']]) } };
    render(AreaAttachModal, { props: PROPS });
    await fireEvent.click(screen.getByTestId('attach-candidate'));
    await fireEvent.click(screen.getByTestId('attach-access-members'));
    await fireEvent.click(screen.getByTestId('attach-confirm'));
    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledOnce());
    const membersCallArgs = /** @type {any[]} */ (attachGroupChannel.mock.calls[0]);
    expect(membersCallArgs[0].pointer).toEqual({
      id: 'book',
      relay: 'wss://g.example/',
      access: 'members'
    });
  });

  it('paste path: previews before the confirm activates, then attaches without access for weltoffen', async () => {
    previewResult.value = { name: 'Lesekreis', picture: null, worldReadable: true };
    render(AreaAttachModal, { props: PROPS });
    await fireEvent.click(screen.getByTestId('attach-paste-toggle'));
    const confirm = /** @type {HTMLButtonElement} */ (screen.getByTestId('attach-confirm'));
    expect(confirm.disabled).toBe(true);
    await fireEvent.input(screen.getByTestId('attach-paste-input'), {
      target: { value: "https://g.example'book" }
    });
    await waitFor(() => expect(screen.getByTestId('attach-preview')).toBeTruthy());
    expect(confirm.disabled).toBe(false);
    await fireEvent.click(confirm);
    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledOnce());
    const worldCallArgs = /** @type {any[]} */ (attachGroupChannel.mock.calls[0]);
    expect(worldCallArgs[0].pointer).toEqual({
      id: 'book',
      relay: 'wss://g.example/'
    });
  });

  it('paste path: shows not-found when the host has no such group', async () => {
    previewResult.value = null;
    render(AreaAttachModal, { props: PROPS });
    await fireEvent.click(screen.getByTestId('attach-paste-toggle'));
    await fireEvent.input(screen.getByTestId('attach-paste-input'), {
      target: { value: "g.example'nope" }
    });
    await waitFor(() =>
      expect(screen.getByTestId('attach-paste-error').textContent).toContain('No group was found')
    );
    expect(/** @type {HTMLButtonElement} */ (screen.getByTestId('attach-confirm')).disabled).toBe(
      true
    );
  });

  it('paste path: clearing the input mid-fetch clears the busy spinner, not just on resolve', async () => {
    // Never resolves — this test is only about the effect's early-return
    // path (clearing input), not about a settled fetch.
    fetchGroupPreview.mockImplementation(() => new Promise(() => {}));
    render(AreaAttachModal, { props: PROPS });
    await fireEvent.click(screen.getByTestId('attach-paste-toggle'));
    await fireEvent.input(screen.getByTestId('attach-paste-input'), {
      target: { value: "https://g.example'book" }
    });
    await waitFor(() => expect(screen.getByTestId('attach-preview-busy')).toBeTruthy());
    await fireEvent.input(screen.getByTestId('attach-paste-input'), { target: { value: '' } });
    await waitFor(() => expect(screen.queryByTestId('attach-preview-busy')).toBeNull());
  });

  it('paste path: opening it keeps the candidate list visible, toggling again hides + resets it', async () => {
    myGroups.value = [{ id: 'book', relay: 'wss://g.example/' }];
    channelMeta.value = { byKey: { 'book@wss://g.example/': meta39000([['private']]) } };
    previewResult.value = { name: 'Pasted', picture: null, worldReadable: true };
    render(AreaAttachModal, { props: PROPS });
    expect(screen.getAllByTestId('attach-candidate')).toHaveLength(1);

    await fireEvent.click(screen.getByTestId('attach-paste-toggle'));
    // The list (and its rows) stay on screen next to the paste field — this
    // is the fix: opening paste used to replace the list entirely.
    expect(screen.getAllByTestId('attach-candidate')).toHaveLength(1);
    await fireEvent.input(screen.getByTestId('attach-paste-input'), {
      target: { value: "https://g.example'other" }
    });
    await waitFor(() => expect(screen.getByTestId('attach-preview')).toBeTruthy());

    // The toggle is a real toggle: clicking again hides the field and
    // resets its state, not a one-way door into paste mode.
    await fireEvent.click(screen.getByTestId('attach-paste-toggle'));
    expect(screen.queryByTestId('attach-paste-input')).toBeNull();
    expect(screen.queryByTestId('attach-preview')).toBeNull();

    // Reopening starts fresh, not with the previous paste still loaded.
    await fireEvent.click(screen.getByTestId('attach-paste-toggle'));
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('attach-paste-input')).value).toBe(
      ''
    );
    expect(screen.queryByTestId('attach-preview')).toBeNull();
  });

  it('paste path: picking a candidate row clears a pasted preview so the target stays unambiguous', async () => {
    myGroups.value = [{ id: 'book', relay: 'wss://g.example/' }];
    channelMeta.value = { byKey: { 'book@wss://g.example/': meta39000([['private']]) } };
    previewResult.value = { name: 'Pasted', picture: null, worldReadable: true };
    render(AreaAttachModal, { props: PROPS });

    await fireEvent.click(screen.getByTestId('attach-paste-toggle'));
    await fireEvent.input(screen.getByTestId('attach-paste-input'), {
      target: { value: "https://g.example'other" }
    });
    await waitFor(() => expect(screen.getByTestId('attach-preview')).toBeTruthy());

    await fireEvent.click(screen.getByTestId('attach-candidate'));
    expect(screen.queryByTestId('attach-preview')).toBeNull();
    expect(/** @type {HTMLInputElement} */ (screen.getByTestId('attach-paste-input')).value).toBe(
      ''
    );

    // Confirming now attaches the picked row, not the (now-cleared) paste.
    await fireEvent.click(screen.getByTestId('attach-confirm'));
    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledOnce());
    const callArgs = /** @type {any[]} */ (attachGroupChannel.mock.calls[0]);
    expect(callArgs[0].pointer.id).toBe('book');
  });

  it('paste path: a preview arriving clears a picked row so the target stays unambiguous (vice versa of the row-click clear)', async () => {
    myGroups.value = [{ id: 'book', relay: 'wss://g.example/' }];
    channelMeta.value = { byKey: { 'book@wss://g.example/': meta39000([['private']]) } };
    previewResult.value = { name: 'Pasted', picture: null, worldReadable: true };
    render(AreaAttachModal, { props: PROPS });

    // Pick the row first — it shows selected (checkmark visible).
    const row = screen.getByTestId('attach-candidate');
    await fireEvent.click(row);
    expect(row.textContent).toContain('✓');

    // Now paste an address that resolves to a preview — the row selection
    // must clear, exactly like picking a row clears a pasted preview.
    await fireEvent.click(screen.getByTestId('attach-paste-toggle'));
    await fireEvent.input(screen.getByTestId('attach-paste-input'), {
      target: { value: "https://g.example'other" }
    });
    await waitFor(() => expect(screen.getByTestId('attach-preview')).toBeTruthy());
    expect(row.textContent).not.toContain('✓');

    // Confirming now attaches the pasted target, not the previously-picked row.
    await fireEvent.click(screen.getByTestId('attach-confirm'));
    await waitFor(() => expect(attachGroupChannel).toHaveBeenCalledOnce());
    const callArgs = /** @type {any[]} */ (attachGroupChannel.mock.calls[0]);
    expect(callArgs[0].pointer.id).toBe('other');
  });

  it('resets the access choice to invited whenever the selected target changes', async () => {
    myGroups.value = [
      { id: 'book', relay: 'wss://g.example/' },
      { id: 'other', relay: 'wss://g.example/' }
    ];
    channelMeta.value = {
      byKey: {
        'book@wss://g.example/': meta39000([['private']]),
        'other@wss://g.example/': {
          kind: 39000,
          tags: [['d', 'other'], ['name', 'Andere'], ['private']]
        }
      }
    };
    render(AreaAttachModal, { props: PROPS });
    const rows = screen.getAllByTestId('attach-candidate');
    await fireEvent.click(
      /** @type {Element} */ (rows.find((r) => r.textContent?.includes('Lesekreis')))
    );
    await fireEvent.click(screen.getByTestId('attach-access-members'));
    expect(
      /** @type {HTMLInputElement} */ (screen.getByTestId('attach-access-members')).checked
    ).toBe(true);

    await fireEvent.click(
      /** @type {Element} */ (rows.find((r) => r.textContent?.includes('Andere')))
    );
    expect(
      /** @type {HTMLInputElement} */ (screen.getByTestId('attach-access-invited')).checked
    ).toBe(true);
  });

  it('a community that already has group channels offers no concord rows', () => {
    concordAreas.value = [
      { communityId: 'area-1', name: 'Team intern', relay: 'wss://c', linkedToJoined: false }
    ];
    myGroups.value = [{ id: 'other', relay: 'wss://g.example/' }];
    const withGroups = {
      kind: 10222,
      pubkey: OWNER,
      tags: [['group', 'linked1', 'wss://g.example/']]
    };
    render(AreaAttachModal, { props: { ...PROPS, communikeyEvent: withGroups } });
    const rows = screen.getAllByTestId('attach-candidate');
    expect(rows.map((r) => r.textContent)).toEqual([expect.stringContaining('Closed group')]);
  });

  it('shows the empty state when nothing is attachable', () => {
    render(AreaAttachModal, { props: PROPS });
    expect(screen.getByText(/not in any group/i)).toBeTruthy();
  });
});
