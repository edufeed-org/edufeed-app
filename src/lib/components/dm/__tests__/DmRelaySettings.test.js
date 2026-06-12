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
import { render } from '@testing-library/svelte';
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

vi.mock('$lib/stores/action-runner.svelte.js', () => ({
  actionRunner: { run: vi.fn().mockResolvedValue(undefined) }
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
