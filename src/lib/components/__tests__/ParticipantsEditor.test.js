/**
 * ParticipantsEditor: add/remove NIP-52 participants with role selection.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

// vi.mock factories are hoisted above top-level const declarations, so this
// mock must be created via vi.hoisted() to keep vi.Mock typing in the tests below.
const getPrimaryWriteRelayMock = vi.hoisted(() => vi.fn(async () => 'wss://relay.test/'));

vi.mock(
  '$lib/components/shared/ContactSearchInput.svelte',
  () => import('./fixtures/ContactSearchInputStub.svelte')
);
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPrimaryWriteRelay: getPrimaryWriteRelayMock
}));
vi.mock('$lib/stores/profile-map.svelte.js', () => ({
  useProfileMap: () => () => new Map()
}));

import Host from './fixtures/ParticipantsEditorHost.svelte';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

/** @param {HTMLElement} el @returns {any[]} */
const readParticipants = (el) => JSON.parse(el.textContent || '[]');

describe('ParticipantsEditor', () => {
  // Issue: the field only suggested the organiser's own follows, so anyone
  // else on Nostr had to be pasted as an npub. Same mode as the community
  // wizard's people step: known profiles + NIP-50 search, follows first.
  it('searches profiles beyond the follow list', () => {
    const { getByTestId } = render(Host);
    expect(getByTestId('stub-search-profiles').textContent).toBe('true');
  });

  it('adds a selected contact with default role and relay hint', async () => {
    const { getByTestId } = render(Host);
    getByTestId('stub-select-a').click();
    // relay hint resolution is async
    await vi.waitFor(() => {
      const list = readParticipants(getByTestId('participants-json'));
      expect(list).toEqual([{ pubkey: PK_A, relay: 'wss://relay.test/', role: 'participant' }]);
    });
  });

  it('does not add the same pubkey twice and excludes added pubkeys from search', async () => {
    const { getByTestId } = render(Host);
    getByTestId('stub-select-a').click();
    await vi.waitFor(() =>
      expect(readParticipants(getByTestId('participants-json'))).toHaveLength(1)
    );
    getByTestId('stub-select-a').click();
    await tick();
    expect(readParticipants(getByTestId('participants-json'))).toHaveLength(1);
    expect(getByTestId('stub-exclude').textContent).toContain(PK_A);
  });

  it('does not add a duplicate when the same pubkey is re-selected before the relay lookup resolves', async () => {
    // Simulates a double-click/re-paste race: both calls pass the pre-await
    // duplicate check while the network lookup for the pubkey is still in flight.
    /** @type {(value: string) => void} */
    let resolveRelay = () => {};
    const deferred = new Promise((resolve) => {
      resolveRelay = resolve;
    });
    getPrimaryWriteRelayMock.mockImplementationOnce(() => deferred);
    getPrimaryWriteRelayMock.mockImplementationOnce(() => deferred);

    const { getByTestId } = render(Host);
    getByTestId('stub-select-a').click();
    getByTestId('stub-select-a').click();

    resolveRelay('wss://relay.test/');
    await vi.waitFor(() => {
      expect(readParticipants(getByTestId('participants-json'))).toHaveLength(1);
    });
    expect(readParticipants(getByTestId('participants-json'))).toEqual([
      { pubkey: PK_A, relay: 'wss://relay.test/', role: 'participant' }
    ]);
  });

  it('uses the selected preset role for newly added participants', async () => {
    const { getByTestId, container } = render(Host);
    const select = /** @type {HTMLSelectElement} */ (
      container.querySelector('[data-testid="participant-role-select"]')
    );
    select.value = 'speaker';
    select.dispatchEvent(new Event('change'));
    await tick();
    getByTestId('stub-select-b').click();
    await vi.waitFor(() => {
      expect(readParticipants(getByTestId('participants-json'))[0].role).toBe('speaker');
    });
  });

  it('uses trimmed custom role text when custom is selected', async () => {
    const { getByTestId, container } = render(Host);
    const select = /** @type {HTMLSelectElement} */ (
      container.querySelector('[data-testid="participant-role-select"]')
    );
    select.value = 'custom';
    select.dispatchEvent(new Event('change'));
    await tick();
    const input = /** @type {HTMLInputElement} */ (
      container.querySelector('[data-testid="participant-role-custom"]')
    );
    input.value = '  Keynote  ';
    input.dispatchEvent(new Event('input'));
    await tick();
    getByTestId('stub-select-a').click();
    await vi.waitFor(() => {
      expect(readParticipants(getByTestId('participants-json'))[0].role).toBe('Keynote');
    });
  });

  it('adds a free-text name (no pubkey) with the selected role and no relay lookup', async () => {
    getPrimaryWriteRelayMock.mockClear();
    const { getByTestId, container } = render(Host);
    const select = /** @type {HTMLSelectElement} */ (
      container.querySelector('[data-testid="participant-role-select"]')
    );
    select.value = 'speaker';
    select.dispatchEvent(new Event('change'));
    await tick();
    getByTestId('stub-name-markus').click();
    await tick();
    expect(readParticipants(getByTestId('participants-json'))).toEqual([
      { name: 'Markus Mustermann', role: 'speaker' }
    ]);
    expect(getPrimaryWriteRelayMock).not.toHaveBeenCalled();
    // the name is listed and can be removed like a pubkey entry
    expect(container.textContent).toContain('Markus Mustermann');
    const removeBtn = /** @type {HTMLButtonElement} */ (
      container.querySelector('[data-testid="participant-remove"]')
    );
    removeBtn.click();
    await tick();
    expect(readParticipants(getByTestId('participants-json'))).toEqual([]);
  });

  it('does not add the same name twice (case-insensitive)', async () => {
    const { getByTestId } = render(Host);
    getByTestId('stub-name-markus').click();
    await tick();
    getByTestId('stub-name-markus-lower').click();
    await tick();
    expect(readParticipants(getByTestId('participants-json'))).toHaveLength(1);
  });

  it('keeps pubkey and named entries side by side and removes only the targeted one', async () => {
    const initial = [
      { pubkey: PK_B, relay: 'wss://r.example/', role: 'organizer' },
      { name: 'Erika Musterfrau', role: 'moderator' }
    ];
    const { getByTestId, container } = render(Host, { initial });
    const removeBtns = container.querySelectorAll('[data-testid="participant-remove"]');
    expect(removeBtns).toHaveLength(2);
    /** @type {HTMLButtonElement} */ (removeBtns[1]).click();
    await tick();
    expect(readParticipants(getByTestId('participants-json'))).toEqual([initial[0]]);
  });

  it('removes a participant and prefills from initial value', async () => {
    const initial = [{ pubkey: PK_B, relay: 'wss://r.example/', role: 'organizer' }];
    const { getByTestId, container } = render(Host, { initial });
    expect(readParticipants(getByTestId('participants-json'))).toEqual(initial);
    const removeBtn = /** @type {HTMLButtonElement} */ (
      container.querySelector('[data-testid="participant-remove"]')
    );
    removeBtn.click();
    await tick();
    expect(readParticipants(getByTestId('participants-json'))).toEqual([]);
  });
});
