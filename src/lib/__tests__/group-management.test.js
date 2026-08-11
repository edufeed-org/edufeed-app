/** @vitest-environment node */
import { describe, it, expect, vi } from 'vitest';
import {
  buildCreateGroupTemplate,
  buildEditGroupMetadataTemplate,
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  buildDeleteGroupTemplate,
  generateGroupId,
  publishToGroupRelay,
  createGroupOnRelay
} from '$lib/groups/group-management.js';
import { of, EMPTY } from 'rxjs';

vi.mock('$lib/groups/relay-auth.js', () => ({
  authenticateOnce: vi.fn(async () => ({ ok: true }))
}));
import { authenticateOnce } from '$lib/groups/relay-auth.js';

const ID = 'abc123def456aa00';
const PK = 'f'.repeat(64);

describe('group management templates', () => {
  it('create-group is a kind 9007 with only the h tag', () => {
    const t = buildCreateGroupTemplate(ID);
    expect(t.kind).toBe(9007);
    expect(t.tags).toEqual([['h', ID]]);
    expect(t.content).toBe('');
    expect(t.created_at).toBeTypeOf('number');
  });

  it('edit-metadata carries fields and BOTH-side markers', () => {
    const t = buildEditGroupMetadataTemplate(ID, {
      name: 'Study group',
      about: 'notes',
      picture: 'https://x/y.png',
      isPublic: false,
      isOpen: false
    });
    expect(t.kind).toBe(9002);
    expect(t.tags).toEqual([
      ['h', ID],
      ['name', 'Study group'],
      ['about', 'notes'],
      ['picture', 'https://x/y.png'],
      ['private'],
      ['closed']
    ]);
  });

  it('edit-metadata skips empty fields and flips markers', () => {
    const t = buildEditGroupMetadataTemplate(ID, { name: '  ', isPublic: true, isOpen: true });
    expect(t.tags).toEqual([['h', ID], ['public'], ['open']]);
  });

  it('put-user matches applesauce shape with and without roles', () => {
    expect(buildPutUserTemplate(ID, PK, ['admin']).tags).toEqual([
      ['h', ID],
      ['p', PK, 'admin']
    ]);
    expect(buildPutUserTemplate(ID, PK).tags).toEqual([
      ['h', ID],
      ['p', PK]
    ]);
    expect(buildPutUserTemplate(ID, PK).kind).toBe(9000);
  });

  it('remove-user and delete-group', () => {
    expect(buildRemoveUserTemplate(ID, PK)).toMatchObject({
      kind: 9001,
      tags: [
        ['h', ID],
        ['p', PK]
      ]
    });
    expect(buildDeleteGroupTemplate(ID)).toMatchObject({ kind: 9008, tags: [['h', ID]] });
  });

  it('generateGroupId yields 16 lowercase hex chars, unique-ish', () => {
    const a = generateGroupId();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(generateGroupId()).not.toBe(a);
  });
});

const user = {
  pubkey: PK,
  signer: { signEvent: vi.fn(async (t) => ({ ...t, id: 'signed', sig: 'sig' })) }
};

describe('publishToGroupRelay', () => {
  it('signs with the user pubkey and resolves on ok', async () => {
    const relayConn = { publish: vi.fn(async () => ({ ok: true })) };
    const signed = await publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user);
    expect(user.signer.signEvent).toHaveBeenCalledWith(expect.objectContaining({ pubkey: PK }));
    expect(relayConn.publish).toHaveBeenCalledOnce();
    expect(signed.id).toBe('signed');
  });

  it('retries exactly once after auth-required, then succeeds', async () => {
    const relayConn = {
      publish: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, message: 'auth-required: join first' })
        .mockResolvedValueOnce({ ok: true })
    };
    await publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user);
    expect(authenticateOnce).toHaveBeenCalledOnce();
    expect(relayConn.publish).toHaveBeenCalledTimes(2);
  });

  it('throws the relay reason on rejection', async () => {
    const relayConn = { publish: vi.fn(async () => ({ ok: false, message: 'restricted: no' })) };
    await expect(
      publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user)
    ).rejects.toThrow('restricted: no');
    expect(relayConn.publish).toHaveBeenCalledOnce(); // no retry on non-auth reasons
  });
});

describe('createGroupOnRelay', () => {
  it('sends 9007 then 9002 and resolves with the confirming 39000', async () => {
    const meta39000 = { kind: 39000, tags: [['d', ID]] };
    const relayConn = {
      publish: vi.fn(async (/** @type {any} */ _event) => ({ ok: true })),
      request: vi.fn(() => of(meta39000))
    };
    const confirmed = await createGroupOnRelay({
      relayConn,
      id: ID,
      user,
      metadata: { name: 'X', isPublic: false, isOpen: false }
    });
    const kinds = relayConn.publish.mock.calls.map(([e]) => e.kind);
    expect(kinds).toEqual([9007, 9002]);
    expect(relayConn.request).toHaveBeenCalledWith(
      { kinds: [39000], '#d': [ID] },
      { timeout: 10000 }
    );
    expect(confirmed).toBe(meta39000);
  });

  it('throws when the relay never announces the group', async () => {
    const relayConn = { publish: vi.fn(async () => ({ ok: true })), request: vi.fn(() => EMPTY) };
    await expect(
      createGroupOnRelay({ relayConn, id: ID, user, metadata: { isPublic: false, isOpen: false } })
    ).rejects.toThrow('group not confirmed by relay');
  });
});
