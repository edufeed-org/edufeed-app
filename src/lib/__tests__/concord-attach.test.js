/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPointerRemoval, attachConcordArea, detachConcordArea } from '$lib/concord/attach.js';

const CID = 'c'.repeat(64);
const PUBKEY = 'a'.repeat(64);

/** @type {{ publish: any, added: any[] }} */
const mockState = vi.hoisted(() => ({ publish: null, added: [] }));

vi.mock('$lib/services/publish-service.js', () => ({
  publishEvent: (/** @type {any[]} */ ...args) => mockState.publish(...args)
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  eventStore: { add: (/** @type {any} */ e) => mockState.added.push(e) }
}));
vi.mock('$lib/helpers/communityRelays.js', () => ({
  getCommunityGlobalRelays: () => ['wss://community.example']
}));

/** Signer that stamps the template with pubkey + fake sig. */
function fakeSigner() {
  return {
    signEvent: vi.fn(async (/** @type {any} */ template) => ({
      ...template,
      pubkey: PUBKEY,
      id: 'e'.repeat(64),
      sig: 'f'.repeat(128)
    }))
  };
}

const communikeyEvent = () => ({
  kind: 10222,
  pubkey: PUBKEY,
  created_at: 1000,
  content: 'community definition',
  tags: [
    ['r', 'wss://x'],
    ['concord', 'b'.repeat(64), 'wss://old.example']
  ]
});

beforeEach(() => {
  mockState.publish = vi.fn(async () => ({ success: true }));
  mockState.added = [];
});

describe('buildPointerRemoval', () => {
  it('produces an unsigned 10222 template without the pointer, preserving the rest', () => {
    const template = buildPointerRemoval(communikeyEvent());
    expect(template.kind).toBe(10222);
    expect(template.content).toBe('community definition');
    expect(template.tags).toEqual([['r', 'wss://x']]);
    expect(template.created_at).toBeGreaterThan(1000);
    expect(template).not.toHaveProperty('id');
    expect(template).not.toHaveProperty('sig');
  });
});

describe('attachConcordArea', () => {
  it('signs the pointer update with the community signer and publishes it', async () => {
    const signer = fakeSigner();
    await attachConcordArea({
      communikeyEvent: communikeyEvent(),
      communityId: CID,
      relay: 'wss://c.example',
      communitySigner: signer
    });
    const template = signer.signEvent.mock.calls[0][0];
    expect(template.tags).toContainEqual(['concord', CID, 'wss://c.example']);
    // publishes via the outbox path including the community's own relays
    expect(mockState.publish).toHaveBeenCalledWith(
      expect.objectContaining({ sig: 'f'.repeat(128) }),
      [],
      {
        additionalRelays: ['wss://community.example']
      }
    );
    // optimistic local echo so the channels tab flips immediately
    expect(mockState.added).toHaveLength(1);
  });

  it('rejects malformed community ids before signing anything', async () => {
    const signer = fakeSigner();
    await expect(
      attachConcordArea({
        communikeyEvent: communikeyEvent(),
        communityId: 'not-hex',
        communitySigner: signer
      })
    ).rejects.toThrow();
    expect(signer.signEvent).not.toHaveBeenCalled();
    expect(mockState.publish).not.toHaveBeenCalled();
  });

  it('throws without a community signer', async () => {
    await expect(
      attachConcordArea({
        communikeyEvent: communikeyEvent(),
        communityId: CID,
        communitySigner: null
      })
    ).rejects.toThrow();
  });
});

describe('detachConcordArea', () => {
  it('signs and publishes the pointer-free 10222', async () => {
    const signer = fakeSigner();
    await detachConcordArea({ communikeyEvent: communikeyEvent(), communitySigner: signer });
    const template = signer.signEvent.mock.calls[0][0];
    expect(template.tags.some((/** @type {string[]} */ t) => t[0] === 'concord')).toBe(false);
    expect(mockState.publish).toHaveBeenCalled();
    expect(mockState.added).toHaveLength(1);
  });

  it('throws without a community signer', async () => {
    await expect(
      detachConcordArea({ communikeyEvent: communikeyEvent(), communitySigner: null })
    ).rejects.toThrow();
  });
});
