// @ts-nocheck -- loose mock shapes
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  published: /** @type {any[]} */ ([]),
  fail: /** @type {any} */ (null)
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: (url) => ({ url }) }
}));
vi.mock('$lib/groups/group-management.js', async (orig) => ({
  ...(await orig()),
  generateGroupId: () => 'room1',
  publishToGroupRelay: vi.fn(async (_relay, template) => {
    if (h.fail?.(template))
      throw new Error('restricted: only members of this relay can create a group');
    h.published.push(template);
    return template;
  }),
  confirmGroupMetadata: vi.fn(async () => ({ kind: 39000, tags: [['d', 'room1']] }))
}));

import {
  startQuickCall,
  callFromConversation,
  parseCallInvite,
  rememberCallOrigin,
  callOriginOf,
  QUICK_CALL_TTL_S
} from '$lib/groups/quick-call.js';
import { callLinkUrl, isPassCode } from '$lib/groups/call-passes.js';

const RELAY = 'wss://groups.example.com/';
const user = {
  pubkey: 'a'.repeat(64),
  signer: { nip44: { encrypt: async (_pk, text) => `enc:${text}`, decrypt: async () => '' } }
};
const names = (tpl) => tpl.tags.map((t) => t.join('='));

describe('startQuickCall', () => {
  beforeEach(() => {
    h.published.length = 0;
    h.fail = null;
  });

  it('creates a room the relay ends itself, unlisted and closed, and a guest link for it', async () => {
    const before = Math.floor(Date.now() / 1000);
    const { pointer, url } = await startQuickCall({
      relay: RELAY,
      user,
      origin: 'https://edufeed.org',
      name: 'Anruf'
    });
    expect(pointer).toEqual({ id: 'room1', relay: RELAY });

    const [create, edit, pass] = h.published;
    expect(create.kind).toBe(9007);
    // the bare tag on the 9007 is what makes the relay own the room's end
    expect(create.tags).toContainEqual(['ephemeral']);
    // a deadline as the safety net, as long as the link lives
    const until = Number(create.tags.find((t) => t[0] === 'until')[1]);
    expect(until).toBeGreaterThanOrEqual(before + QUICK_CALL_TTL_S);
    expect(edit.kind).toBe(9002);
    for (const tag of ['name=Anruf', 'public', 'closed', 'hidden', 'livekit', 'ephemeral'])
      expect(names(edit)).toContain(tag);

    expect(pass.kind).toBe(9025);
    expect(names(pass)).toContain('h=room1');
    expect(pass.tags.some((t) => t[0] === 'scope')).toBe(false);
    const expiration = Number(pass.tags.find((t) => t[0] === 'expiration')[1]);
    expect(expiration).toBeGreaterThanOrEqual(before + QUICK_CALL_TTL_S);

    const invite = parseCallInvite(`Komm dazu:\n${url}`, 'https://edufeed.org');
    expect(invite.pointer).toEqual(pointer);
    expect(isPassCode(invite.code)).toBe(true);
    expect(url.startsWith('https://edufeed.org/call/')).toBe(true);
  });

  it('passes the relay refusal on and mints no pass', async () => {
    h.fail = (tpl) => tpl.kind === 9007;
    await expect(
      startQuickCall({ relay: RELAY, user, origin: 'https://edufeed.org', name: 'Anruf' })
    ).rejects.toThrow(/only members of this relay/);
    expect(h.published).toEqual([]);
  });
});

describe('parseCallInvite', () => {
  const pointer = { id: 'abc123', relay: 'wss://groups.example.com/' };
  const CODE = 'k7Qm2xPz9RtLw4Ybk7Qm2x';
  const ORIGIN = 'https://edufeed.org';
  const url = callLinkUrl(ORIGIN, pointer, CODE);

  it('finds a call link anywhere in a message', () => {
    expect(isPassCode(CODE)).toBe(true);
    expect(parseCallInvite(`Ich habe einen Anruf gestartet.\n${url}`, ORIGIN)).toEqual({
      url,
      pointer,
      code: CODE
    });
  });

  it('ignores everything else', () => {
    expect(parseCallInvite('hello', ORIGIN)).toBeNull();
    expect(parseCallInvite(null, ORIGIN)).toBeNull();
    expect(parseCallInvite(url.replace(CODE, 'x'), ORIGIN)).toBeNull(); // no valid code
    expect(parseCallInvite(url.split('#')[0], ORIGIN)).toBeNull(); // a link without a code is no invite
  });
});

describe('parseCallInvite and other websites', () => {
  it('a call-shaped link to another website is no invitation: it stays a plain link', () => {
    const pointer = { id: 'abc123', relay: 'wss://groups.example.com/' };
    const foreign = callLinkUrl('https://evil.example', pointer, 'k7Qm2xPz9RtLw4Ybk7Qm2x');
    expect(parseCallInvite(foreign, 'https://edufeed.org')).toBeNull();
    // a look-alike host does not pass either
    expect(
      parseCallInvite(
        foreign.replace('evil.example', 'edufeed.org.evil.example'),
        'https://edufeed.org'
      )
    ).toBeNull();
  });
});

describe('callFromConversation', () => {
  const args = (join, send) => ({
    relay: RELAY,
    user,
    origin: 'https://edufeed.org',
    name: 'Anruf',
    join,
    send
  });
  beforeEach(() => {
    h.published.length = 0;
    h.fail = null;
  });

  it('sends the invitation only once the caller is in the call', async () => {
    const order = [];
    const started = await callFromConversation(
      args(
        async (pointer) => {
          order.push(`join ${pointer.id}`);
          return true;
        },
        async (url) => {
          order.push(`send ${url.startsWith('https://edufeed.org/call/')}`);
        }
      )
    );
    expect(started).toBe(true);
    expect(order).toEqual(['join room1', 'send true']);
    expect(h.published.some((t) => t.kind === 9008)).toBe(false);
  });

  it('a cancelled camera check invites nobody and removes the unused room at once', async () => {
    const send = vi.fn();
    const started = await callFromConversation(args(async () => false, send));
    expect(started).toBe(false);
    expect(send).not.toHaveBeenCalled();
    const del = h.published.at(-1);
    expect(del.kind).toBe(9008);
    expect(del.tags).toContainEqual(['h', 'room1']);
  });

  it('a failed removal of the unused room is not an error', async () => {
    h.fail = (tpl) => tpl.kind === 9008;
    await expect(callFromConversation(args(async () => false, vi.fn()))).resolves.toBe(false);
  });
});

describe('where a quick call was started from', () => {
  const room = { id: 'room1', relay: 'wss://groups.example.com/' };
  const PEER = 'b'.repeat(64);

  it('remembers the conversation of the latest call for the way back', () => {
    const store = new Map();
    vi.stubGlobal('sessionStorage', {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v)
    });
    expect(callOriginOf(room)).toBeNull();
    rememberCallOrigin(room, PEER);
    expect(callOriginOf(room)).toBe(PEER);
    expect(callOriginOf({ ...room, id: 'other' })).toBeNull();
    store.set([...store.keys()][0], '{"id":"room1","pubkey":"javascript:alert(1)"}');
    expect(callOriginOf(room)).toBeNull(); // only a pubkey ever becomes part of a link
    vi.unstubAllGlobals();
  });

  it('works without storage', () => {
    expect(() => rememberCallOrigin(room, PEER)).not.toThrow();
    expect(callOriginOf(room)).toBeNull();
  });
});
