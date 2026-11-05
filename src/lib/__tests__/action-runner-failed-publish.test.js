/** @vitest-environment node */
/**
 * A replaceable published through an ActionRunner must not outlive a publish
 * that no relay accepted. applesauce's ActionRunner adds the event to the
 * store BEFORE publishing (evicting the version it replaces), and our
 * publishEvent resolves `{ success: false }` instead of rejecting — so a
 * total failure used to leave the unpublished version in the store, with the
 * previous one gone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { EventStore } = await import('applesauce-core');
  return { eventStore: new EventStore() };
});
vi.mock('$lib/stores/app-settings.svelte.js', () => ({ appSettings: {} }));
vi.mock('$lib/stores/config.svelte.js', () => ({ runtimeConfig: {} }));

const sk = generateSecretKey();
const pubkey = getPublicKey(sk);
vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: {
    signer: {
      getPublicKey: async () => pubkey,
      signEvent: async (/** @type {any} */ d) => finalizeEvent(d, sk)
    }
  }
}));

const publishEvent = vi.hoisted(() => vi.fn());
const publishEventOptimistic = vi.hoisted(() => vi.fn());
vi.mock('$lib/services/publish-service.js', () => ({ publishEvent, publishEventOptimistic }));
vi.mock('$lib/services/gift-wrap-publish.js', () => ({
  publishGiftWrap: vi.fn(async () => ({ success: true })),
  GIFT_WRAP_KIND: 1059
}));

const { actionRunner, actionRunnerOptimistic } = await import(
  '$lib/stores/action-runner.svelte.js'
);
const { eventStore } = await import('$lib/stores/nostr-infrastructure.svelte');
const store = { current: /** @type {any} */ (eventStore) };

/** @param {number} createdAt @param {string} word */
function muteList(createdAt, word) {
  return finalizeEvent(
    { kind: 10000, created_at: createdAt, tags: [['word', word]], content: '' },
    sk
  );
}

/** An action that publishes a prepared event. @param {any} event */
const PublishPrepared =
  (event) =>
  async (/** @type {any} */ { publish }) =>
    publish(event);

describe('ActionRunner — failed publish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.current.removeByFilters({ authors: [pubkey] });
  });

  it('blocking runner rejects and keeps the previous version when no relay accepts', async () => {
    const previous = muteList(1_000, 'old');
    store.current.add(previous);
    publishEvent.mockResolvedValue({ success: false, relays: ['wss://a'], successCount: 0 });

    await expect(actionRunner.run(PublishPrepared, muteList(2_000, 'new'))).rejects.toThrow(
      /relay/
    );

    expect(store.current.getReplaceable(10000, pubkey)?.id).toBe(previous.id);
  });

  it('blocking runner stores the event once a relay accepted it', async () => {
    store.current.add(muteList(1_000, 'old'));
    publishEvent.mockResolvedValue({ success: true, relays: ['wss://a'], successCount: 1 });
    const next = muteList(2_000, 'new');

    await actionRunner.run(PublishPrepared, next);

    expect(store.current.getReplaceable(10000, pubkey)?.id).toBe(next.id);
  });

  it('optimistic runner hands the event to publishEventOptimistic before the store replaces anything', async () => {
    const previous = muteList(1_000, 'old');
    store.current.add(previous);
    /** @type {string | undefined} */
    let storedAtPublish;
    publishEventOptimistic.mockImplementation(() => {
      storedAtPublish = store.current.getReplaceable(10000, pubkey)?.id;
    });
    const next = muteList(2_000, 'new');

    await actionRunnerOptimistic.run(PublishPrepared, next);

    // publishEventOptimistic captures the replaced version for its rollback
    // (and reports failure through the publish status toast) — it can only
    // do that while the previous version is still in the store.
    expect(publishEventOptimistic).toHaveBeenCalledWith(next, [], { additionalRelays: [] });
    expect(storedAtPublish).toBe(previous.id);
  });
});
