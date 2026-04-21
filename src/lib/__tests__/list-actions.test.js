/**
 * Tests for the generic list actions that cover NIP-51 kinds without
 * pre-built applesauce actions (communities 10004, public chats 10005,
 * emoji list 10030, emoji sets 30030, starter packs 39089) and the
 * create/delete helpers used for any list kind.
 *
 * We construct a fake action context matching applesauce's
 * `{ factory, user, publish, sign }` contract so the tests never touch
 * the network or the real EventStore.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as kinds from 'nostr-tools/kinds';

import { ModifyListTags, CreateList, DeleteList } from '../actions/list-actions.js';

// --- Fake context helpers -------------------------------------------------

/** @param {{ existing?: any, outboxes?: string[], pubkey?: string }} [opts] */
function createContext({ existing, outboxes = ['wss://out.example'], pubkey = 'u1' } = {}) {
  const published = /** @type {any[]} */ ([]);
  const signed = /** @type {any[]} */ ([]);

  const publish = vi.fn(async (/** @type {any} */ evt, /** @type {string[]=} */ relays) => {
    published.push({ event: evt, relays });
  });

  const sign = vi.fn(async (/** @type {any} */ draft) => {
    const s = {
      ...draft,
      id: 'id-' + signed.length,
      pubkey,
      sig: 'sig-' + signed.length
    };
    signed.push(s);
    return s;
  });

  const factory = {
    // event operations are thunks that transform {tags, content, kind}
    modify: vi.fn(async (/** @type {any} */ evt, ...eventOps) => {
      // Each eventOp is an EventOperation that we invoke, which in turn
      // calls TagOperations against evt.tags. For our purposes we
      // simulate modifyPublicTags/modifyHiddenTags by inspecting a tag
      // marker we attach below.
      let tags = evt.tags;
      let content = evt.content ?? '';
      for (const op of eventOps) {
        if (!op) continue;
        const result = await op({ ...evt, tags, content }, { signer: undefined });
        tags = result.tags;
        content = result.content ?? content;
      }
      return { kind: evt.kind, tags, content, created_at: 111 };
    }),
    build: vi.fn(async (/** @type {any} */ template, ...eventOps) => {
      let tags = template.tags ? [...template.tags] : [];
      let content = template.content ?? '';
      for (const op of eventOps) {
        if (!op) continue;
        const result = await op({ ...template, tags, content }, { signer: undefined });
        tags = result.tags;
        content = result.content ?? content;
      }
      return { kind: template.kind, tags, content, created_at: 111 };
    }),
    sign: vi.fn(async (/** @type {any} */ draft) => sign(draft)),
    delete: vi.fn(async (/** @type {any[]} */ events) => ({
      kind: 5,
      created_at: 111,
      tags: events.map((e) => ['e', e.id]),
      content: ''
    }))
  };

  const user = {
    pubkey,
    replaceable: vi.fn((/** @type {number} */ _k, /** @type {string=} */ _id) => ({
      $first: vi.fn(async () => existing)
    })),
    outboxes$: {
      $first: vi.fn(async () => outboxes)
    }
  };

  const events = {
    getReplaceable: vi.fn(() => existing)
  };

  return /** @type {any} */ ({
    self: pubkey,
    run: vi.fn(),
    factory,
    user,
    publish,
    sign,
    events,
    published,
    signed
  });
}

// --- Tests ---------------------------------------------------------------

describe('ModifyListTags — add', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a new event when the list does not exist (singleton)', async () => {
    const ctx = createContext({ existing: undefined });
    const action = ModifyListTags({
      kind: 10005, // public chats — no applesauce action
      add: [['e', 'chat-event-id']]
    });
    await action(ctx);

    expect(ctx.factory.build).toHaveBeenCalledTimes(1);
    expect(ctx.factory.modify).not.toHaveBeenCalled();
    expect(ctx.sign).toHaveBeenCalledTimes(1);
    expect(ctx.publish).toHaveBeenCalledWith(expect.objectContaining({ kind: 10005 }), [
      'wss://out.example'
    ]);
    const draft = ctx.factory.build.mock.calls[0][0];
    expect(draft.kind).toBe(10005);
    // No d-tag on singleton kinds
    expect(draft.tags?.find?.((/** @type {string[]} */ t) => t[0] === 'd')).toBeUndefined();
    // The new event carries the added tag
    expect(ctx.signed[0].tags).toContainEqual(['e', 'chat-event-id']);
  });

  it('preserves the d-tag when building a new addressable list', async () => {
    const ctx = createContext({ existing: undefined });
    const action = ModifyListTags({
      kind: 30030, // emoji set
      dTag: 'my-emoji',
      add: [['emoji', ':shipit:', 'https://example.com/shipit.png']]
    });
    await action(ctx);

    const draft = ctx.factory.build.mock.calls[0][0];
    expect(draft.kind).toBe(30030);
    expect(draft.tags).toContainEqual(['d', 'my-emoji']);
    expect(ctx.signed[0].tags).toContainEqual([
      'emoji',
      ':shipit:',
      'https://example.com/shipit.png'
    ]);
  });

  it('modifies an existing list (preserves title/description and siblings)', async () => {
    const existing = {
      kind: 39089,
      pubkey: 'u1',
      created_at: 100,
      tags: [
        ['d', 'starter-1'],
        ['title', 'My starter pack'],
        ['description', 'folks I like'],
        ['p', 'friend-a'],
        ['p', 'friend-b']
      ],
      content: ''
    };
    const ctx = createContext({ existing });
    const action = ModifyListTags({
      kind: 39089,
      dTag: 'starter-1',
      add: [['p', 'friend-c']]
    });
    await action(ctx);

    expect(ctx.factory.modify).toHaveBeenCalledTimes(1);
    expect(ctx.factory.build).not.toHaveBeenCalled();

    const signed = ctx.signed[0];
    const pTags = signed.tags.filter((/** @type {string[]} */ t) => t[0] === 'p');
    expect(pTags).toEqual([
      ['p', 'friend-a'],
      ['p', 'friend-b'],
      ['p', 'friend-c']
    ]);
    expect(signed.tags.find((/** @type {string[]} */ t) => t[0] === 'title')).toEqual([
      'title',
      'My starter pack'
    ]);
    expect(signed.tags.find((/** @type {string[]} */ t) => t[0] === 'description')).toEqual([
      'description',
      'folks I like'
    ]);
    expect(signed.tags.find((/** @type {string[]} */ t) => t[0] === 'd')).toEqual([
      'd',
      'starter-1'
    ]);
  });
});

describe('ModifyListTags — remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes only the matching tag and keeps siblings', async () => {
    const existing = {
      kind: 10004,
      pubkey: 'u1',
      created_at: 100,
      tags: [
        ['a', '34550:owner1:community-1'],
        ['a', '34550:owner2:community-2'],
        ['a', '34550:owner3:community-3']
      ],
      content: ''
    };
    const ctx = createContext({ existing });
    const action = ModifyListTags({
      kind: 10004,
      remove: [['a', '34550:owner2:community-2']]
    });
    await action(ctx);

    const signed = ctx.signed[0];
    const aTags = signed.tags.filter((/** @type {string[]} */ t) => t[0] === 'a');
    expect(aTags).toEqual([
      ['a', '34550:owner1:community-1'],
      ['a', '34550:owner3:community-3']
    ]);
  });
});

describe('ModifyListTags — hidden tags', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects when hidden=true is requested for a non-hiddable kind', async () => {
    // 10002 (RelayList) does not support hidden tags per NIP
    const ctx = createContext({ existing: undefined });
    const action = ModifyListTags({
      kind: kinds.RelayList,
      hidden: true,
      add: [['r', 'wss://relay.example']]
    });
    await expect(action(ctx)).rejects.toThrow();
  });
});

describe('CreateList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an addressable list with d, title, description, image', async () => {
    const ctx = createContext({ existing: undefined });
    const action = CreateList({
      kind: kinds.Interestsets,
      dTag: 'my-interests',
      title: 'Topics I follow',
      description: 'longer description',
      image: 'https://example.com/cover.png',
      items: [
        ['t', 'nostr'],
        ['t', 'edufeed']
      ]
    });
    await action(ctx);

    expect(ctx.factory.build).toHaveBeenCalledTimes(1);
    const signed = ctx.signed[0];
    expect(signed.kind).toBe(kinds.Interestsets);
    expect(signed.tags).toContainEqual(['d', 'my-interests']);
    expect(signed.tags).toContainEqual(['title', 'Topics I follow']);
    expect(signed.tags).toContainEqual(['description', 'longer description']);
    expect(signed.tags).toContainEqual(['image', 'https://example.com/cover.png']);
    expect(signed.tags).toContainEqual(['t', 'nostr']);
    expect(signed.tags).toContainEqual(['t', 'edufeed']);
    expect(ctx.publish).toHaveBeenCalledWith(signed, ['wss://out.example']);
  });

  it('generates a d-tag for addressable kinds when none is supplied', async () => {
    const ctx = createContext({ existing: undefined });
    await CreateList({
      kind: kinds.Followsets,
      title: 'Untitled'
    })(ctx);

    const signed = ctx.signed[0];
    const dTag = signed.tags.find((/** @type {string[]} */ t) => t[0] === 'd');
    expect(dTag).toBeTruthy();
    expect(typeof dTag[1]).toBe('string');
    expect(dTag[1].length).toBeGreaterThan(0);
  });
});

describe('DeleteList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds a kind-5 delete event and publishes it', async () => {
    const target = {
      id: 'target-event-id',
      kind: kinds.Interestsets,
      pubkey: 'u1',
      created_at: 100,
      tags: [['d', 'goodbye']],
      content: '',
      sig: 'sig'
    };
    const ctx = createContext({ existing: target });
    await DeleteList(target)(ctx);

    expect(ctx.factory.delete).toHaveBeenCalledWith([target]);
    expect(ctx.publish).toHaveBeenCalledTimes(1);
    const publishedEvt = ctx.publish.mock.calls[0][0];
    expect(publishedEvt.kind).toBe(5);
  });

  it('refuses to delete an event owned by another pubkey', async () => {
    const foreign = {
      id: 'x',
      kind: kinds.Interestsets,
      pubkey: 'someone-else',
      created_at: 100,
      tags: [['d', 'goodbye']],
      content: '',
      sig: 'sig'
    };
    const ctx = createContext({ existing: foreign });
    await expect(DeleteList(foreign)(ctx)).rejects.toThrow();
  });
});
