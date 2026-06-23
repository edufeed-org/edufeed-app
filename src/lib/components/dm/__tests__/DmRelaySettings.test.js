/**
 * DmRelaySettings — the settings editor must show the user's *actual* kind
 * 10050 DM relay list (what they publish), NOT the broader gift-wrap listening
 * union (NIP-65 write + fallback + 10050) the dm-service subscribes to. The
 * add/remove buttons operate on the real 10050 event, so the displayed list
 * has to match that event.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { of } from 'rxjs';

vi.mock('$lib/paraglide/messages', () =>
  Object.fromEntries(
    [
      'dm_relay_settings_title',
      'dm_relay_settings_description',
      'dm_relay_add',
      'dm_relay_remove',
      'dm_relay_placeholder',
      'dm_no_relays_title'
    ].map((k) => [k, () => k])
  )
);

const mockActiveUser = vi.hoisted(() => ({ value: /** @type {any} */ ({ pubkey: 'abc123' }) }));
vi.mock('$lib/stores/accounts.svelte', () => ({
  useActiveUser: () => () => mockActiveUser.value
}));

const mockReplaceable = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { replaceable: mockReplaceable }
}));

const mockRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: { run: mockRun }
}));

vi.mock('applesauce-actions/actions', () => ({
  AddDirectMessageRelay: 'AddDirectMessageRelay',
  RemoveDirectMessageRelay: 'RemoveDirectMessageRelay',
  NewDirectMessageRelays: 'NewDirectMessageRelays'
}));

import DmRelaySettings from '../DmRelaySettings.svelte';

describe('DmRelaySettings', () => {
  beforeEach(() => {
    mockActiveUser.value = { pubkey: 'abc123' };
    mockReplaceable.mockReset();
    mockRun.mockClear();
  });

  /** @param {HTMLElement} container */
  async function addRelayViaUi(container) {
    const input = /** @type {HTMLInputElement} */ (container.querySelector('input[type="text"]'));
    await fireEvent.input(input, { target: { value: 'wss://dm.edufeed.org' } });
    const addButton = /** @type {HTMLButtonElement} */ (
      [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('dm_relay_add'))
    );
    await fireEvent.click(addButton);
  }

  it('uses AddDirectMessageRelay when an empty kind 10050 already exists (no "already exists" error)', async () => {
    // An empty 10050 (e.g. after removing the last relay) exists in the store
    // but renders as "no relays". Adding must MODIFY that event, never call
    // NewDirectMessageRelays — which throws "DM relays event already exists".
    mockReplaceable.mockReturnValue(of({ kind: 10050, pubkey: 'abc123', tags: [] }));

    const { container } = render(DmRelaySettings);
    await addRelayViaUi(container);

    expect(mockRun).toHaveBeenCalledWith('AddDirectMessageRelay', 'wss://dm.edufeed.org');
    expect(mockRun).not.toHaveBeenCalledWith('NewDirectMessageRelays', expect.anything());
  });

  it('uses AddDirectMessageRelay when the user has no kind 10050 event at all', async () => {
    // AddDirectMessageRelay builds a fresh 10050 when none exists, so the
    // component no longer needs a separate create branch.
    mockReplaceable.mockReturnValue(of(undefined));

    const { container } = render(DmRelaySettings);
    await addRelayViaUi(container);

    expect(mockRun).toHaveBeenCalledWith('AddDirectMessageRelay', 'wss://dm.edufeed.org');
  });

  it('shows exactly the relays in the kind 10050 event, not the listening union', () => {
    mockReplaceable.mockReturnValue(
      of({
        kind: 10050,
        pubkey: 'abc123',
        tags: [['relay', 'wss://dm.edufeed.org/']]
      })
    );

    const { getByText, queryByText } = render(DmRelaySettings);

    expect(getByText('wss://dm.edufeed.org/')).toBeTruthy();
    expect(queryByText('wss://relay.damus.io/')).toBeNull();
    expect(queryByText('wss://nos.lol/')).toBeNull();
  });

  it('shows the empty state when the user has no kind 10050 event', () => {
    mockReplaceable.mockReturnValue(of(undefined));

    const { getByText } = render(DmRelaySettings);

    expect(getByText('dm_no_relays_title')).toBeTruthy();
  });

  it('queries the active user pubkey for kind 10050', () => {
    mockReplaceable.mockReturnValue(of(undefined));
    render(DmRelaySettings);
    expect(mockReplaceable).toHaveBeenCalledWith(10050, 'abc123');
  });
});
