/** @vitest-environment node */
/**
 * createAppEventFactory — the app's compat wrapper over applesauce v6.
 *
 * v6 removed the legacy EventFactory class; this wrapper preserves the
 * legacy call shape (.build/.modify/.modifyTags/.delete/.sign) used across
 * ~50 call sites, implemented on v6 context-free operations. Tests run
 * against the real v6 code — no factory mocks — asserting produced event
 * shapes (kind/tags/content/created_at/client tag).
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

// Import after mocks are set up
const { createAppEventFactory } = await import('$lib/helpers/event-factory.js');

const PUBKEY = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

/** @returns {any} minimal signer that "signs" by stamping fake id/sig */
function fakeSigner() {
  return {
    getPublicKey: async () => PUBKEY,
    signEvent: vi.fn(async (/** @type {any} */ draft) => ({
      ...draft,
      id: 'f'.repeat(64),
      sig: 'e'.repeat(128),
      pubkey: PUBKEY
    }))
  };
}

describe('createAppEventFactory (v6 compat wrapper)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppSettings.includeClientTag = true;
    mockRuntimeConfig.clientName = 'TestApp';
  });

  describe('build', () => {
    it('fills template defaults and applies the client tag when enabled', async () => {
      const factory = createAppEventFactory();
      const draft = await factory.build({ kind: 30000, tags: [['d', 'my-list']] });

      expect(draft.kind).toBe(30000);
      expect(draft.content).toBe('');
      expect(typeof draft.created_at).toBe('number');
      expect(draft.tags).toContainEqual(['d', 'my-list']);
      expect(draft.tags.some((/** @type {string[]} */ t) => t[0] === 'client')).toBe(true);
      expect(draft.tags.find((/** @type {string[]} */ t) => t[0] === 'client')?.[1]).toBe(
        'TestApp'
      );
    });

    it('omits the client tag when disabled', async () => {
      mockAppSettings.includeClientTag = false;
      const factory = createAppEventFactory();
      const draft = await factory.build({ kind: 1, content: 'hi' });

      expect(draft.tags.some((/** @type {string[]} */ t) => t[0] === 'client')).toBe(false);
    });

    it('adds a d tag to addressable kinds that lack one', async () => {
      const factory = createAppEventFactory();
      const draft = await factory.build({ kind: 30023, content: 'article' });

      expect(draft.tags.some((/** @type {string[]} */ t) => t[0] === 'd' && t[1])).toBe(true);
    });

    it('honours an explicit created_at instead of stamping now', async () => {
      // calendar-actions' updateEvent depends on this to guarantee a
      // replacement is strictly newer than the event it replaces — a
      // same-second replacement is dropped by the relay, the EventStore and
      // the IDB cache alike (#62). The default here is `unixNow()`, so a
      // spread-order regression in build() would silently re-open that.
      const factory = createAppEventFactory();
      const pinned = 1700000000;
      const draft = await factory.build({ kind: 31922, content: '', created_at: pinned });

      expect(draft.created_at).toBe(pinned);
    });

    it('applies operations in order', async () => {
      const factory = createAppEventFactory();
      const addFoo = (/** @type {any} */ d) => ({ ...d, tags: [...d.tags, ['foo', '1']] });
      const addBar = (/** @type {any} */ d) => ({ ...d, tags: [...d.tags, ['bar', '2']] });
      const draft = await factory.build({ kind: 1 }, addFoo, addBar);

      const fooIdx = draft.tags.findIndex((/** @type {string[]} */ t) => t[0] === 'foo');
      const barIdx = draft.tags.findIndex((/** @type {string[]} */ t) => t[0] === 'bar');
      expect(fooIdx).toBeGreaterThanOrEqual(0);
      expect(barIdx).toBeGreaterThan(fooIdx);
    });
  });

  describe('modify', () => {
    it('refreshes created_at and strips signature fields', async () => {
      const factory = createAppEventFactory();
      const existing = {
        kind: 10003,
        content: '',
        tags: [['e', 'a'.repeat(64)]],
        created_at: 1000,
        pubkey: PUBKEY,
        id: '1'.repeat(64),
        sig: '2'.repeat(128)
      };
      const draft = await factory.modify(existing);

      expect(draft.created_at).toBeGreaterThan(1000);
      expect(draft.id).toBeUndefined();
      expect(draft.sig).toBeUndefined();
      expect(draft.tags).toContainEqual(['e', 'a'.repeat(64)]);
    });
  });

  describe('delete', () => {
    it('builds a kind 5 deletion with e tags for the given events', async () => {
      const factory = createAppEventFactory();
      const target = {
        kind: 1,
        id: 'a'.repeat(64),
        pubkey: PUBKEY,
        content: '',
        tags: [],
        created_at: 1,
        sig: ''
      };
      const draft = await factory.delete([target]);

      expect(draft.kind).toBe(5);
      expect(
        draft.tags.some((/** @type {string[]} */ t) => t[0] === 'e' && t[1] === 'a'.repeat(64))
      ).toBe(true);
    });
  });

  describe('sign', () => {
    it('signs a draft with the configured signer', async () => {
      const signer = fakeSigner();
      const factory = createAppEventFactory({ signer });
      const draft = await factory.build({ kind: 1, content: 'hello' });
      const signed = await factory.sign(draft);

      expect(signer.signEvent).toHaveBeenCalled();
      expect(signed.pubkey).toBe(PUBKEY);
      expect(signed.kind).toBe(1);
    });

    it('throws without a signer', async () => {
      const factory = createAppEventFactory();
      await expect(
        factory.sign({ kind: 1, content: '', tags: [], created_at: 1 })
      ).rejects.toThrow();
    });
  });
});
