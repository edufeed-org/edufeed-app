/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// app-settings touches window.matchMedia at module load through transitive
// imports; stub before importing.
if (typeof window !== 'undefined' && !window.matchMedia) {
  // @ts-expect-error minimal shim for module-load-time calls
  window.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {}
  });
}

// Hoisted shared mock state — vi.mock factories run before normal imports,
// so use vi.hoisted() to share a mutable container between test bodies and
// the factory.
const mocks = vi.hoisted(() => ({
  captured: /** @type {any[]} */ ([]),
  events: /** @type {any[]} */ ([])
}));

vi.mock('$lib/stores/nostr-infrastructure.svelte', async () => {
  const { from } = await import('rxjs');
  return {
    pool: {
      request: (/** @type {string[]} */ relays, /** @type {any} */ filter) => {
        mocks.captured.push({ relays, filter });
        return from(mocks.events);
      }
    },
    eventStore: { add: () => {} }
  };
});

vi.mock('$lib/helpers/relay-helper.js', () => ({
  getEducationalRelays: () => ['wss://relay.example']
}));

const { findExistingLicense } = await import('../image-license.js');

beforeEach(() => {
  mocks.captured.length = 0;
  mocks.events.length = 0;
});

describe('findExistingLicense', () => {
  it('returns null when no events arrive', async () => {
    const result = await findExistingLicense('a'.repeat(64));
    expect(result).toBeNull();
  });

  it('queries educational relays with the correct filter', async () => {
    await findExistingLicense('a'.repeat(64));
    expect(mocks.captured).toHaveLength(1);
    expect(mocks.captured[0].relays).toEqual(['wss://relay.example']);
    expect(mocks.captured[0].filter).toEqual([{ kinds: [1063], '#x': ['a'.repeat(64)] }]);
  });

  it('returns the newest event by created_at', async () => {
    mocks.events.push(
      { id: 'old', kind: 1063, created_at: 100, tags: [['x', 'a'.repeat(64)]] },
      { id: 'new', kind: 1063, created_at: 200, tags: [['x', 'a'.repeat(64)]] }
    );
    const result = await findExistingLicense('a'.repeat(64));
    expect(result?.id).toBe('new');
  });

  it('breaks ties by id lex order (smaller id wins)', async () => {
    mocks.events.push(
      { id: 'bbb', kind: 1063, created_at: 100, tags: [] },
      { id: 'aaa', kind: 1063, created_at: 100, tags: [] }
    );
    const result = await findExistingLicense('a'.repeat(64));
    expect(result?.id).toBe('aaa');
  });

  it('returns null and does not throw on empty hash', async () => {
    const result = await findExistingLicense('');
    expect(result).toBeNull();
  });
});
