// @ts-nocheck -- loose mock shapes
/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';

const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: (url) => ({ request: (...a) => request(url, ...a) }) },
  eventStore: {}
}));
// leaveWholeCommunity's side (leave-whole-community.test.js) is not under test here.
vi.mock('$lib/helpers/community.js', () => ({}));
vi.mock('$lib/groups/group-management.js', () => ({}));
vi.mock('$lib/groups/personal-groups-list.js', () => ({}));

import { listedChannelsBelow, findListedChannelsBelow } from '$lib/groups/leave-community.js';

const HOST = 'wss://groups.example/';
const root = { id: 'root1', relay: 'wss://groups.example/c/root1' };
const meta = (id, parent) => ({
  kind: 39000,
  tags: [['d', id], ...(parent ? [['parent', parent]] : [])]
});
const listed = [
  { id: 'root1', relay: 'wss://groups.example/c/root1' },
  { id: 'viaEndpoint', relay: 'wss://Groups.example/c/root1/' }, // other spelling, same endpoint
  { id: 'flatChild', relay: 'wss://groups.example' },
  { id: 'flatOther', relay: 'wss://groups.example' }, // a channel of another community
  { id: 'flatLoose', relay: 'wss://groups.example' }, // no parent at all
  { id: 'otherEndpoint', relay: 'wss://groups.example/c/root2' },
  { id: 'elsewhere', relay: 'wss://other.example' }
];
const metadata = [meta('flatChild', 'root1'), meta('flatOther', 'root2'), meta('flatLoose')];

describe('channels of a community in my list', () => {
  it('finds the ones under the community endpoint and the flat ones whose parent is the root', () => {
    expect(listedChannelsBelow(root, listed, metadata).map((e) => e.id)).toEqual([
      'viaEndpoint',
      'flatChild'
    ]);
  });

  it('works when the root itself is addressed on the flat host', () => {
    const flatRoot = { id: 'root1', relay: HOST };
    expect(listedChannelsBelow(flatRoot, listed, metadata).map((e) => e.id)).toEqual([
      'viaEndpoint',
      'flatChild'
    ]);
  });

  it('asks the flat host about the flat-listed entries only, once', async () => {
    request.mockReturnValue(of(...metadata));
    const found = await findListedChannelsBelow(root, listed);
    expect(found.map((e) => e.id)).toEqual(['viaEndpoint', 'flatChild']);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe(HOST);
    expect(request.mock.calls[0][1]).toEqual({
      kinds: [39000],
      '#d': ['flatChild', 'flatOther', 'flatLoose']
    });
  });

  it('still finds the endpoint entries when the relay does not answer', async () => {
    request.mockReturnValue(throwError(() => new Error('down')));
    expect((await findListedChannelsBelow(root, listed)).map((e) => e.id)).toEqual(['viaEndpoint']);
  });

  it('asks nothing when no entry is listed on the flat host', async () => {
    request.mockClear();
    await findListedChannelsBelow(root, [listed[0], listed[1], listed[6]]);
    expect(request).not.toHaveBeenCalled();
  });
});
