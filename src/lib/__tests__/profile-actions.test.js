/**
 * Tests for custom profile actions (kind 0) that applesauce-actions doesn't
 * cover: appending an additional `["nip05", <address>]` event tag while
 * leaving the content JSON (and its primary nip05) untouched.
 *
 * Fake action context matches applesauce's `{ factory, user, publish, sign }`
 * contract — same approach as list-actions.test.js.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';

import { AddProfileNip05Tag } from '../actions/profile-actions.js';

/** @param {{ profileEvent?: any, outboxes?: string[], pubkey?: string }} [opts] */
function createContext({ profileEvent, outboxes = ['wss://out.example'], pubkey = 'u1' } = {}) {
  const published = /** @type {any[]} */ ([]);

  const publish = vi.fn(async (/** @type {any} */ evt, /** @type {string[]=} */ relays) => {
    published.push({ event: evt, relays });
  });

  const sign = vi.fn(async (/** @type {any} */ draft) => ({
    ...draft,
    id: 'signed-id',
    pubkey,
    sig: 'sig'
  }));

  const factory = {
    modify: vi.fn(async (/** @type {any} */ evt, ...eventOps) => {
      let tags = evt.tags;
      let content = evt.content ?? '';
      for (const op of eventOps) {
        if (!op) continue;
        const result = await op({ ...evt, tags, content }, { signer: undefined });
        tags = result.tags;
        content = result.content ?? content;
      }
      return { kind: evt.kind, tags, content, created_at: 111 };
    })
  };

  const user = {
    pubkey,
    profile$: { $first: vi.fn(async () => (profileEvent ? { event: profileEvent } : undefined)) },
    outboxes$: { $first: vi.fn(async () => outboxes) }
  };

  return { ctx: { factory, user, publish, sign }, published, publish, sign };
}

describe('AddProfileNip05Tag', () => {
  it('appends a nip05 tag, preserving content and existing tags', async () => {
    const profileEvent = {
      kind: 0,
      pubkey: 'u1',
      content: JSON.stringify({ name: 'Maria', nip05: 'maria@other.org' }),
      tags: [['nip05', 'maria@somewhere.net']]
    };
    const { ctx, published } = createContext({ profileEvent });

    await AddProfileNip05Tag('maria@edufeed.org')(/** @type {any} */ (ctx));

    expect(published).toHaveLength(1);
    const evt = published[0].event;
    expect(evt.kind).toBe(0);
    // content untouched — primary nip05 stays
    expect(JSON.parse(evt.content)).toEqual({ name: 'Maria', nip05: 'maria@other.org' });
    // existing tag kept, new tag appended
    expect(evt.tags).toEqual([
      ['nip05', 'maria@somewhere.net'],
      ['nip05', 'maria@edufeed.org']
    ]);
    // published to the user's outboxes
    expect(published[0].relays).toEqual(['wss://out.example']);
  });

  it('throws when the user has no profile event', async () => {
    const { ctx } = createContext({ profileEvent: undefined });
    await expect(AddProfileNip05Tag('maria@edufeed.org')(/** @type {any} */ (ctx))).rejects.toThrow(
      /profile/i
    );
  });
});
