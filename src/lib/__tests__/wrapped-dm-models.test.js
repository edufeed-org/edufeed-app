/** @vitest-environment node */
/**
 * Local replacements for applesauce's WrappedMessages* models, which keep
 * kind 14 only. A conversation whose newest event is a file must still appear
 * in the list, and a private reaction must reach the thread without becoming
 * a message bubble.
 */
import { describe, it, expect, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';

const rumors = new Map();
vi.mock('applesauce-common/helpers/gift-wrap', () => ({
  getGiftWrapRumor: (wrap) => rumors.get(wrap.id)
}));
vi.mock('applesauce-core/observable', () => ({ watchEventsUpdates: () => (source) => source }));

import { DmRumorsModel, DmConversationsModel, DmThreadModel } from '$lib/models/wrapped-dm.js';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);

/** @param {string} id @param {number} kind @param {number} at @param {string[][]} [extra] @param {string} [content] */
function wrap(id, kind, at, extra = [], content = '') {
  rumors.set(id, {
    id: `r-${id}`,
    pubkey: ME,
    kind,
    created_at: at,
    tags: [['p', PEER], ...extra],
    content
  });
  return { id, kind: 1059, created_at: at, tags: [['p', ME]], content: '' };
}

/** store stub: timeline() returns the wraps we hand it; model() routes through the same store,
 * matching the applesauce convention (and what real EventStore memoisation relies on). */
const storeWith = (wraps) => {
  const store = {
    timeline: () => of(wraps),
    model: (factory, ...args) => factory(...args)(store)
  };
  return store;
};

describe('DmRumorsModel', () => {
  it('keeps chat, file and reaction rumors and drops everything else, newest first', async () => {
    rumors.clear();
    const store = storeWith([
      wrap('w1', 14, 100),
      wrap('w2', 15, 300, [], 'https://x/a.bin'),
      wrap('w3', 7, 200, [['e', 'r-w1']], '+'),
      wrap('w4', 1, 400)
    ]);
    const out = await firstValueFrom(DmRumorsModel(ME)(store));
    expect(out.map((r) => r.kind)).toEqual([15, 7, 14]);
  });

  it('skips wraps that are still locked (no rumor yet)', async () => {
    rumors.clear();
    const locked = { id: 'w9', kind: 1059, created_at: 1, tags: [['p', ME]], content: '' };
    const out = await firstValueFrom(DmRumorsModel(ME)(storeWith([locked])));
    expect(out).toEqual([]);
  });
});

describe('DmConversationsModel', () => {
  it('lists a conversation whose only message is a file', async () => {
    rumors.clear();
    const store = storeWith([wrap('w1', 15, 100, [], 'https://x/a.bin')]);
    const [conv] = await firstValueFrom(DmConversationsModel(ME)(store));
    expect(conv.id).toBe([ME, PEER].sort().join(':'));
    expect(conv.participants.sort()).toEqual([ME, PEER].sort());
    expect(conv.lastMessage.kind).toBe(15);
  });

  it('never lets a reaction become the conversation preview', async () => {
    rumors.clear();
    const store = storeWith([wrap('w1', 14, 100), wrap('w2', 7, 999, [['e', 'r-w1']], '+')]);
    const [conv] = await firstValueFrom(DmConversationsModel(ME)(store));
    expect(conv.lastMessage.kind).toBe(14);
  });
});

describe('DmThreadModel', () => {
  it('returns the conversation messages oldest-first with reactions keyed by target', async () => {
    rumors.clear();
    const store = storeWith([
      wrap('w1', 14, 100),
      wrap('w2', 15, 200, [], 'https://x/a.bin'),
      wrap('w3', 7, 300, [['e', 'r-w1']], '🔥')
    ]);
    const out = await firstValueFrom(DmThreadModel(ME, [ME, PEER])(store));
    expect(out.messages.map((m) => m.kind)).toEqual([14, 15]);
    expect(out.reactionsByTarget.get('r-w1')?.map((r) => r.content)).toEqual(['🔥']);
  });

  it('excludes other conversations', async () => {
    rumors.clear();
    const OTHER = 'c'.repeat(64);
    const store = storeWith([wrap('w1', 14, 100)]);
    const out = await firstValueFrom(DmThreadModel(ME, [ME, OTHER])(store));
    expect(out.messages).toEqual([]);
  });
});
