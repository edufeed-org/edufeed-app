/** @vitest-environment node */
// updatePersonalGroupsList must NOT add the signed event to the eventStore
// itself: publishEventOptimistic captures the version it replaces BEFORE its
// own add (#64 rollback). A pre-add makes that capture see the replacement,
// so a total publish failure would evict the predecessor and roll back to
// nothing — the user's whole groups list gone locally.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const eventStore = vi.hoisted(() => ({
  add: vi.fn(),
  getReplaceable: vi.fn(() => null)
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({ eventStore }));

const publishEventOptimistic = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/publish-service.js', () => ({ publishEventOptimistic }));

const { updatePersonalGroupsList } = await import('$lib/groups/personal-groups-list.js');

describe('updatePersonalGroupsList', () => {
  const user = {
    pubkey: 'a'.repeat(64),
    signer: {
      signEvent: vi.fn(async (/** @type {any} */ t) => ({ ...t, id: 'ev1', sig: 'x' }))
    }
  };

  beforeEach(() => {
    eventStore.add.mockClear();
    publishEventOptimistic.mockClear();
  });

  it('hands the signed 10009 to publishEventOptimistic without pre-adding it', async () => {
    await updatePersonalGroupsList(user, { add: { id: 'g1', relay: 'wss://groups.example' } });

    expect(publishEventOptimistic).toHaveBeenCalledOnce();
    const [signed] = publishEventOptimistic.mock.calls[0];
    expect(signed.kind).toBe(10009);
    expect(signed.tags).toEqual(expect.arrayContaining([['group', 'g1', 'wss://groups.example/']]));
    // The publish path owns the one and only eventStore.add — a caller-side
    // pre-add defeats its replaced-version rollback.
    expect(eventStore.add).not.toHaveBeenCalled();
  });

  it('does nothing without a signer', async () => {
    await updatePersonalGroupsList(null, { add: { id: 'g1', relay: 'wss://x' } });
    expect(publishEventOptimistic).not.toHaveBeenCalled();
  });
});
