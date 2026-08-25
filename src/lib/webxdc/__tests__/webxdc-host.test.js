/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWebxdcHost } from '../webxdc-host.js';

/** @typedef {{payload: any, info?: any, document?: any, summary?: any}} FakeUpdate */

function fakeSync() {
  /** @type {FakeUpdate[]} */
  const updates = [];
  /** @type {Set<() => void>} */
  const subs = new Set();
  /** @type {Set<(bytes: Uint8Array) => void>} */
  const rt = new Set();
  return {
    updates,
    getUpdates: () => updates,
    sendState: vi.fn((/** @type {any} */ payload, /** @type {any} */ meta = undefined) => {
      updates.push({ payload, ...meta });
      for (const cb of subs) cb();
    }),
    sendRealtime: vi.fn(),
    onRealtime: (/** @type {(bytes: Uint8Array) => void} */ cb) => (
      rt.add(cb), () => rt.delete(cb)
    ),
    emitRealtime: (/** @type {Uint8Array} */ bytes) => rt.forEach((cb) => cb(bytes)),
    subscribe: (/** @type {() => void} */ cb) => (subs.add(cb), () => subs.delete(cb))
  };
}

const identity = { selfAddr: 'npub1abc', selfName: 'Tester' };

describe('createWebxdcHost', () => {
  /** @type {ReturnType<typeof fakeSync>} */
  let sync;
  /** @type {ReturnType<typeof createWebxdcHost>} */
  let host;
  /** @type {{method?: string, params?: any}[]} */
  let posts;
  /** @type {(msg: object) => void} */
  let post;
  beforeEach(() => {
    sync = fakeSync();
    host = createWebxdcHost(sync, identity);
    posts = [];
    post = (msg) => posts.push(msg);
  });

  it('bridgeScript embeds identity and caps', () => {
    expect(host.bridgeScript).toContain('"npub1abc"');
    expect(host.bridgeScript).toContain('"Tester"');
    expect(host.bridgeScript).toContain('window.webxdc');
    expect(host.bridgeScript).toContain('65536');
    expect(host.bridgeScript).toContain('128000');
  });

  it('bridgeScript rejects messages not sourced from window.parent as the first check', () => {
    const script = host.bridgeScript;
    const listenerBody = script.slice(script.indexOf("addEventListener('message'"));
    expect(listenerBody).toContain('if (event.source !== window.parent) return;');
    // Must be the first statement in the handler body — a spoofed-source
    // message must never reach the jsonrpc/id/method dispatch below it.
    const guardIndex = listenerBody.indexOf('if (event.source !== window.parent) return;');
    const firstBraceIndex = listenerBody.indexOf('{') + 1;
    expect(listenerBody.slice(firstBraceIndex, guardIndex).trim()).toBe('');
  });

  it('sendUpdate forwards payload and meta to sync', async () => {
    await host.handleRpc('webxdc.sendUpdate', { update: { payload: { a: 1 }, info: 'i' } }, post);
    expect(sync.sendState).toHaveBeenCalledWith(
      { a: 1 },
      { info: 'i', document: undefined, summary: undefined }
    );
  });

  it('rejects oversized updates', async () => {
    const big = { update: { payload: 'x'.repeat(70000) } };
    await expect(host.handleRpc('webxdc.sendUpdate', big, post)).rejects.toThrow(/65536/);
  });

  it('setUpdateListener replays past updates with serials, then streams live ones', async () => {
    sync.sendState({ n: 1 });
    sync.sendState({ n: 2 });
    host.start(post);
    await host.handleRpc('webxdc.setUpdateListener', { serial: 1 }, post);
    const replayed = posts.filter((p) => p.method === 'webxdc.update');
    expect(replayed).toHaveLength(1);
    expect(replayed[0].params.update).toMatchObject({
      payload: { n: 2 },
      serial: 2,
      max_serial: 2
    });

    sync.sendState({ n: 3 });
    const live = posts.filter((p) => p.method === 'webxdc.update');
    expect(live.at(-1)?.params.update).toMatchObject({
      payload: { n: 3 },
      serial: 3,
      max_serial: 3
    });
  });

  it('getAllUpdates returns serialized updates', async () => {
    sync.sendState({ n: 1 });
    const all = await host.handleRpc('webxdc.getAllUpdates', {}, post);
    expect(all).toEqual([{ payload: { n: 1 }, serial: 1, max_serial: 1 }]);
  });

  it('realtime join/send/leave with cap', async () => {
    await host.handleRpc('webxdc.realtimeChannel.join', {}, post);
    sync.emitRealtime(new Uint8Array([7, 8]));
    expect(posts.at(-1)).toMatchObject({
      method: 'webxdc.realtimeChannel.data',
      params: { data: [7, 8] }
    });

    await host.handleRpc('webxdc.realtimeChannel.send', { data: [1, 2, 3] }, post);
    expect(sync.sendRealtime).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));

    await expect(
      host.handleRpc('webxdc.realtimeChannel.send', { data: new Array(128001).fill(0) }, post)
    ).rejects.toThrow(/128/);

    await host.handleRpc('webxdc.realtimeChannel.leave', {}, post);
    sync.emitRealtime(new Uint8Array([9]));
    expect(posts.filter((p) => p.method === 'webxdc.realtimeChannel.data')).toHaveLength(1);
  });

  it('unknown method rejects', async () => {
    await expect(host.handleRpc('nope', {}, post)).rejects.toThrow(/unknown/i);
  });
});
