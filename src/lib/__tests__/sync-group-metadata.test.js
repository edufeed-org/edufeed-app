/** @vitest-environment node */
// Task A7: re-issuing a 9002 edit-metadata whenever the linked community's
// profile changes. The relay-generated 39000 only ever got name/about/
// picture copied ONCE, at flip-to-moderated time (provisionRootGroup) — this
// keeps it from drifting stale. Mirrors the CURRENT flags (private/closed/
// parent) off the relay's own 39000 rather than declaring them, so a profile
// save can never accidentally flip visibility (same pattern GroupSettingsSheet
// uses for its own edits).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, EMPTY } from 'rxjs';

const publishToGroupRelay = vi.fn();
vi.mock('$lib/groups/group-management.js', async (importOriginal) => {
  const actual = /** @type {any} */ (await importOriginal());
  return {
    ...actual,
    // buildEditGroupMetadataTemplate + confirmGroupMetadata stay REAL — the
    // test asserts on the actual tag shape they produce together.
    publishToGroupRelay: (/** @type {any} */ ...args) => publishToGroupRelay(...args)
  };
});

/** @type {any} */
let relayConn;
vi.mock('$lib/stores/nostr-infrastructure.svelte', () => ({
  pool: { relay: vi.fn(() => relayConn) }
}));

const { syncRootGroupMetadata } = await import('$lib/groups/sync-group-metadata.js');

const POINTER = { id: 'root1', relay: 'wss://groups.example.com' };
const PROFILE = { name: 'New', about: 'about text', picture: 'https://x.example/pic.png' };
const USER = { pubkey: 'a'.repeat(64), signer: {} };

beforeEach(() => {
  publishToGroupRelay.mockReset().mockResolvedValue({ id: 'signed' });
});

describe('syncRootGroupMetadata', () => {
  it('mirrors current private/closed flags and publishes a 9002 with the new profile fields', async () => {
    relayConn = {
      request: vi.fn(() => of({ kind: 39000, tags: [['d', POINTER.id], ['private'], ['closed']] }))
    };
    const result = await syncRootGroupMetadata({
      pointer: POINTER,
      profile: PROFILE,
      signerUser: USER
    });
    expect(result).toEqual({ ok: true });
    expect(publishToGroupRelay).toHaveBeenCalledOnce();
    const [conn, template, user] = publishToGroupRelay.mock.calls[0];
    expect(conn).toBe(relayConn);
    expect(template.kind).toBe(9002);
    expect(template.tags).toEqual(
      expect.arrayContaining([
        ['name', 'New'],
        ['about', 'about text'],
        ['picture', 'https://x.example/pic.png'],
        ['private'],
        ['closed'],
        ['restricted']
      ])
    );
    expect(user).toBe(USER);
  });

  it('mirrors public/open + an existing parent tag through unchanged', async () => {
    relayConn = {
      request: vi.fn(() =>
        of({
          kind: 39000,
          tags: [['d', POINTER.id], ['public'], ['open'], ['parent', 'root0']]
        })
      )
    };
    await syncRootGroupMetadata({ pointer: POINTER, profile: PROFILE, signerUser: USER });
    const [, template] = publishToGroupRelay.mock.calls[0];
    expect(template.tags).toContainEqual(['public']);
    expect(template.tags).toContainEqual(['open']);
    expect(template.tags).toContainEqual(['parent', 'root0']);
  });

  it('defaults to public/open with no parent when the relay has no 39000 yet', async () => {
    relayConn = { request: vi.fn(() => EMPTY) };
    await syncRootGroupMetadata({ pointer: POINTER, profile: PROFILE, signerUser: USER });
    const [, template] = publishToGroupRelay.mock.calls[0];
    expect(template.tags).toContainEqual(['public']);
    expect(template.tags).toContainEqual(['open']);
    expect(template.tags.some((/** @type {string[]} */ t) => t[0] === 'parent')).toBe(false);
  });

  it('returns {ok:false} without throwing when the relay rejects the publish', async () => {
    relayConn = { request: vi.fn(() => of({ kind: 39000, tags: [] })) };
    publishToGroupRelay.mockRejectedValue(new Error('restricted: no'));
    const result = await syncRootGroupMetadata({
      pointer: POINTER,
      profile: PROFILE,
      signerUser: USER
    });
    expect(result).toEqual({ ok: false, error: 'restricted: no' });
  });

  it('never throws even when the relay fetch itself blows up', async () => {
    relayConn = {
      request: vi.fn(() => {
        throw new Error('socket died');
      })
    };
    const result = await syncRootGroupMetadata({
      pointer: POINTER,
      profile: PROFILE,
      signerUser: USER
    });
    expect(result).toEqual({ ok: false, error: 'socket died' });
    expect(publishToGroupRelay).not.toHaveBeenCalled();
  });
});
