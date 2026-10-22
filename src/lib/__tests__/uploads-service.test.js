// @ts-nocheck
/**
 * removeUpload — Blossom DELETE (BUD-01 auth) on every hosting server, then
 * NIP-09 on the kind-1063 attestation.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const createDeleteAuth = vi.fn(async (signer, hash) => ({
  kind: 24242,
  tags: [
    ['t', 'delete'],
    ['x', hash]
  ]
}));
const deleteBlob = vi.fn(async () => true);
vi.mock('blossom-client-sdk', () => ({
  BlossomClient: { createDeleteAuth, deleteBlob }
}));

const deleteEvent = vi.fn(async () => ({ success: true }));
vi.mock('$lib/helpers/eventDeletion.js', () => ({
  deleteEvent: (...args) => deleteEvent(...args)
}));

const { removeUpload } = await import('$lib/services/uploads-service.js');

const HASH = 'c'.repeat(64);
const user = { pubkey: 'p'.repeat(64), signer: { signEvent: vi.fn(async (t) => t) } };
const license = {
  id: '1'.repeat(64),
  kind: 1063,
  pubkey: user.pubkey,
  created_at: 1,
  content: '',
  tags: [
    ['url', `https://blossom.edufeed.org/${HASH}.png`],
    ['x', HASH],
    ['m', 'image/png']
  ]
};

describe('removeUpload', () => {
  beforeEach(() => {
    createDeleteAuth.mockClear();
    deleteBlob.mockClear();
    deleteEvent.mockClear();
    deleteBlob.mockImplementation(async () => true);
  });

  it('signs one delete auth for the hash and deletes on every server, then the 1063', async () => {
    const result = await removeUpload(license, user, {
      servers: ['https://blossom.edufeed.org', 'https://mirror.example']
    });

    expect(createDeleteAuth).toHaveBeenCalledTimes(1);
    expect(createDeleteAuth.mock.calls[0][1]).toBe(HASH);
    expect(deleteBlob).toHaveBeenCalledTimes(2);
    expect(deleteBlob.mock.calls[0][0]).toBe('https://blossom.edufeed.org');
    expect(deleteBlob.mock.calls[0][1]).toBe(HASH);
    expect(deleteBlob.mock.calls[0][2].auth.kind).toBe(24242);
    expect(deleteEvent).toHaveBeenCalledWith(license, user);
    expect(result).toEqual({
      success: true,
      blossom: [
        { server: 'https://blossom.edufeed.org', status: 'deleted' },
        { server: 'https://mirror.example', status: 'deleted' }
      ]
    });
  });

  it('treats a 404 as already gone and still deletes the attestation', async () => {
    deleteBlob.mockImplementation(async () => {
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    });
    const result = await removeUpload(license, user, { servers: ['https://blossom.edufeed.org'] });
    expect(result.success).toBe(true);
    expect(result.blossom).toEqual([{ server: 'https://blossom.edufeed.org', status: 'missing' }]);
    expect(deleteEvent).toHaveBeenCalledTimes(1);
  });

  it('reports a failed server but still publishes the kind 5', async () => {
    deleteBlob.mockImplementation(async (server) => {
      if (server === 'https://mirror.example') throw new Error('boom');
      return true;
    });
    const result = await removeUpload(license, user, {
      servers: ['https://blossom.edufeed.org', 'https://mirror.example']
    });
    expect(result.success).toBe(true);
    expect(result.blossom).toEqual([
      { server: 'https://blossom.edufeed.org', status: 'deleted' },
      { server: 'https://mirror.example', status: 'failed' }
    ]);
    expect(deleteEvent).toHaveBeenCalledTimes(1);
  });

  it('skips Blossom entirely without servers and fails when the kind 5 fails', async () => {
    deleteEvent.mockImplementation(async () => ({ success: false, error: 'nope' }));
    const result = await removeUpload(license, user, { servers: [] });
    expect(deleteBlob).not.toHaveBeenCalled();
    expect(createDeleteAuth).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false, blossom: [], error: 'nope' });
  });

  it('refuses attestations of other people and events without a hash', async () => {
    const foreign = { ...license, pubkey: 'q'.repeat(64) };
    expect((await removeUpload(foreign, user, { servers: [] })).success).toBe(false);
    const noHash = { ...license, tags: [['url', 'https://x/y.png']] };
    expect((await removeUpload(noHash, user, { servers: [] })).success).toBe(false);
    expect(deleteEvent).not.toHaveBeenCalled();
  });

  it('refuses to sign a delete auth when the user is not the signer', async () => {
    const result = await removeUpload(license, null, { servers: ['https://blossom.edufeed.org'] });
    expect(result.success).toBe(false);
    expect(createDeleteAuth).not.toHaveBeenCalled();
  });
});
