// @ts-nocheck
/**
 * enableGroupCalls — the admin's one-click "Start call" in a channel that is
 * not an AV space yet. It sends a 9002 that switches `livekit` on while
 * restating EVERY other field of the current 39000: a NIP-29 edit replaces
 * the metadata, so anything left out (name, private/closed, hidden, parent)
 * would be lost.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { confirmGroupMetadata, publishToGroupRelay, relayConn } = vi.hoisted(() => ({
  confirmGroupMetadata: vi.fn(),
  publishToGroupRelay: vi.fn(async () => {}),
  relayConn: { url: 'wss://groups.example/' }
}));
vi.mock('$lib/groups/group-management.js', async (importOriginal) => ({
  ...(await importOriginal()),
  confirmGroupMetadata,
  publishToGroupRelay
}));
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: () => relayConn }
}));

const { enableGroupCalls } = await import('$lib/groups/enable-group-calls.js');

const POINTER = { id: 'g1', relay: 'wss://groups.example/' };
const USER = { pubkey: 'a'.repeat(64), signer: {} };

beforeEach(() => {
  confirmGroupMetadata.mockReset();
  publishToGroupRelay.mockClear();
});

describe('enableGroupCalls', () => {
  it('switches livekit on and restates every other field of the current 39000', async () => {
    confirmGroupMetadata.mockResolvedValue({
      kind: 39000,
      tags: [
        ['d', 'g1'],
        ['name', 'Physik 9b'],
        ['about', 'Kursraum'],
        ['picture', 'https://img.example/p.png'],
        ['private'],
        ['open'],
        ['hidden'],
        ['parent', 'root-group']
      ]
    });
    await enableGroupCalls(POINTER, USER);
    expect(confirmGroupMetadata).toHaveBeenCalledWith(relayConn, 'g1');
    const [conn, template, user] = publishToGroupRelay.mock.calls[0];
    expect(conn).toBe(relayConn);
    expect(user).toBe(USER);
    expect(template.kind).toBe(9002);
    expect(template.tags).toEqual(
      expect.arrayContaining([
        ['h', 'g1'],
        ['name', 'Physik 9b'],
        ['about', 'Kursraum'],
        ['picture', 'https://img.example/p.png'],
        ['private'],
        ['open'],
        ['hidden'],
        ['livekit'],
        ['parent', 'root-group']
      ])
    );
  });

  it('reads public / closed right', async () => {
    confirmGroupMetadata.mockResolvedValue({
      kind: 39000,
      tags: [['d', 'g1'], ['name', 'Offen'], ['closed']]
    });
    await enableGroupCalls(POINTER, USER);
    const template = publishToGroupRelay.mock.calls[0][1];
    expect(template.tags).toEqual(expect.arrayContaining([['public'], ['closed'], ['livekit']]));
    expect(template.tags).not.toContainEqual(['hidden']);
  });

  it('refuses to send anything when the current metadata cannot be read', async () => {
    confirmGroupMetadata.mockResolvedValue(null);
    await expect(enableGroupCalls(POINTER, USER)).rejects.toThrow();
    expect(publishToGroupRelay).not.toHaveBeenCalled();
  });
});
