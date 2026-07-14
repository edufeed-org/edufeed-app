/** @vitest-environment node */
/**
 * ActionRunner client-tag signer wrapper (issue #38 follow-up).
 *
 * v6's ActionRunner signs via the signer directly (the v5 factory context
 * that auto-applied the NIP-89 client tag is gone). The store wraps the
 * account signer so every action-signed event gets the client tag when the
 * user has opted in. setClient() self-guards on DM kinds (4/13/14/1059),
 * so seals and legacy DMs stay untagged.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAppSettings = { includeClientTag: true };
vi.mock('$lib/stores/app-settings.svelte.js', () => ({
  appSettings: mockAppSettings
}));

const mockRuntimeConfig = { clientName: 'TestApp' };
vi.mock('$lib/stores/config.svelte.js', () => ({
  runtimeConfig: mockRuntimeConfig
}));

/** @type {any} */
const innerSigner = {
  getPublicKey: vi.fn(async () => 'a'.repeat(64)),
  signEvent: vi.fn(async (/** @type {any} */ draft) => ({
    ...draft,
    id: 'f'.repeat(64),
    sig: 'e'.repeat(128),
    pubkey: 'a'.repeat(64)
  })),
  nip04: { encrypt: vi.fn(), decrypt: vi.fn() },
  nip44: { encrypt: vi.fn(), decrypt: vi.fn() }
};

vi.mock('$lib/stores/accounts.svelte', () => ({
  manager: { signer: innerSigner }
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: vi.fn() }
}));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: vi.fn(async () => ({ success: true }))
}));

vi.mock('$lib/services/gift-wrap-publish.js', () => ({
  publishGiftWrap: vi.fn(async () => ({ success: true })),
  GIFT_WRAP_KIND: 1059
}));

const { actionRunner, actionRunnerOptimistic } = await import(
  '$lib/stores/action-runner.svelte.js'
);

/** @param {number} kind */
function draftOf(kind) {
  return { kind, content: '', tags: [], created_at: 1_700_000_000 };
}

describe('ActionRunner client-tag signer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppSettings.includeClientTag = true;
    mockRuntimeConfig.clientName = 'TestApp';
  });

  it('appends the client tag to action-signed events when enabled', async () => {
    const signed = await actionRunner.signer.signEvent(draftOf(3));

    expect(signed.tags).toContainEqual(['client', 'TestApp']);
    // the inner signer received the tagged draft
    const received = innerSigner.signEvent.mock.calls[0][0];
    expect(received.tags).toContainEqual(['client', 'TestApp']);
  });

  it('does not tag when the user has opted out', async () => {
    mockAppSettings.includeClientTag = false;
    const signed = await actionRunner.signer.signEvent(draftOf(3));

    expect(signed.tags.some((/** @type {string[]} */ t) => t[0] === 'client')).toBe(false);
  });

  it('does not tag when no client name is configured', async () => {
    mockRuntimeConfig.clientName = '';
    const signed = await actionRunner.signer.signEvent(draftOf(3));

    expect(signed.tags.some((/** @type {string[]} */ t) => t[0] === 'client')).toBe(false);
  });

  it('never tags NIP-59 seals (kind 13) even when enabled', async () => {
    const signed = await actionRunner.signer.signEvent(draftOf(13));

    expect(signed.tags).toEqual([]);
  });

  it('never tags legacy DMs (kind 4)', async () => {
    const signed = await actionRunner.signer.signEvent(draftOf(4));

    expect(signed.tags).toEqual([]);
  });

  it('delegates getPublicKey and encryption interfaces to the account signer', async () => {
    await expect(actionRunner.signer.getPublicKey()).resolves.toBe('a'.repeat(64));
    expect(actionRunner.signer.nip04).toBe(innerSigner.nip04);
    expect(actionRunner.signer.nip44).toBe(innerSigner.nip44);
  });

  it('both runner variants share the wrapped signer', () => {
    expect(actionRunnerOptimistic.signer).toBe(actionRunner.signer);
  });
});
