/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import { groupPreviewFromMetadata, fetchGroupPreview } from '$lib/groups/group-preview.js';
import { of, EMPTY } from 'rxjs';

const meta = (/** @type {string[][]} */ extra = []) => ({
  kind: 39000,
  tags: [['d', 'book'], ['name', 'Lesekreis'], ...extra]
});

describe('groupPreviewFromMetadata', () => {
  it('shapes name, picture and world-readability', () => {
    expect(groupPreviewFromMetadata(meta([['picture', 'https://x/y.png']]))).toEqual({
      name: 'Lesekreis',
      picture: 'https://x/y.png',
      worldReadable: true
    });
    expect(groupPreviewFromMetadata(meta([['private']]))).toEqual({
      name: 'Lesekreis',
      picture: null,
      worldReadable: false
    });
  });

  it('falls back to the d tag when the group has no name, null for non-39000', () => {
    expect(
      groupPreviewFromMetadata({ kind: 39000, tags: [['d', 'book'], ['private']] })
    ).toMatchObject({ name: 'book' });
    expect(groupPreviewFromMetadata(null)).toBeNull();
    expect(groupPreviewFromMetadata({ kind: 1, tags: [] })).toBeNull();
  });
});

describe('fetchGroupPreview', () => {
  it('resolves the shaped preview from the relay answer', async () => {
    const relayConn = { request: vi.fn(() => of(meta())) };
    await expect(fetchGroupPreview(relayConn, { id: 'book', relay: 'wss://x' })).resolves.toEqual({
      name: 'Lesekreis',
      picture: null,
      worldReadable: true
    });
    expect(relayConn.request).toHaveBeenCalledWith(
      { kinds: [39000], '#d': ['book'] },
      { timeout: 10000 }
    );
  });

  it('resolves null when the host answers nothing or errors', async () => {
    await expect(
      fetchGroupPreview({ request: () => EMPTY }, { id: 'book', relay: 'wss://x' })
    ).resolves.toBeNull();
    await expect(
      fetchGroupPreview(
        {
          request: () => {
            throw new Error('boom');
          }
        },
        { id: 'book', relay: 'wss://x' }
      )
    ).resolves.toBeNull();
  });
});
