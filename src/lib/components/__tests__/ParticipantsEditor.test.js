/**
 * ParticipantsEditor: add/remove NIP-52 participants with role selection.
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

vi.mock(
  '$lib/components/shared/ContactSearchInput.svelte',
  () => import('./fixtures/ContactSearchInputStub.svelte')
);
vi.mock('$lib/services/relay-service.svelte.js', () => ({
  getPrimaryWriteRelay: vi.fn(async () => 'wss://relay.test/')
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
