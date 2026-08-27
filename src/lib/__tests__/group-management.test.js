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
  createGroupOnRelay,
  confirmGroupAdmins,
  isRelayMembershipRequired
} from '$lib/groups/group-management.js';
import { getGroupAdmins } from 'applesauce-common/helpers/groups';
import { of, EMPTY } from 'rxjs';

vi.mock('$lib/groups/relay-auth.js', () => ({
  authenticateOnce: vi.fn(async () => ({ ok: true }))
}));
import { authenticateOnce } from '$lib/groups/relay-auth.js';

const ID = 'abc123def456aa00';
const PK = 'f'.repeat(64);

describe('group management templates', () => {
  it('create-group is a kind 9007 carrying the metadata inline', () => {
    // The buzz relay (0.2.0) validates the 9007 itself: "invalid: channel
    // name is required". A bare ["h", id] create is rejected there, so the
    // create carries the same tags the 9002 does — harmless on relays that
    // ignore them (khatru/0xchat, measured).
    const t = buildCreateGroupTemplate(ID, { name: 'Study group', isPublic: false, isOpen: false });
    expect(t.kind).toBe(9007);
    expect(t.tags).toEqual([
      ['h', ID],
      ['name', 'Study group'],
      ['private'],
      ['closed'],
      ['restricted']
    ]);
    expect(t.content).toBe('');
    expect(t.created_at).toBeTypeOf('number');
  });

  it('create-group without metadata still has the h tag alone', () => {
    expect(buildCreateGroupTemplate(ID).tags).toEqual([['h', ID]]);
  });

  it('edit-metadata carries fields, BOTH-side markers, and restricted', () => {
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
      ['closed'],
      ['restricted']
    ]);
  });

  it('restricted is set even on a world-open group — open means open to READ', () => {
    // Design round 4 (buzz thread): "restricted bleibt in allen drei Stufen
    // gesetzt, sonst schreibt das halbe Netz in euren Ankündigungskanal."
    const t = buildEditGroupMetadataTemplate(ID, { name: '  ', isPublic: true, isOpen: true });
    expect(t.tags).toEqual([['h', ID], ['public'], ['open'], ['restricted']]);
  });

  it('edit-metadata carries a parent tag pointing at the community root group when given one', () => {
    // NIP-29 Subgroups: a relay-side patch will auto-admit root-group
    // members into channels that declare the root as their parent.
    const t = buildEditGroupMetadataTemplate(ID, {
      name: 'x',
      isPublic: true,
      isOpen: true,
      parent: 'root1'
    });
    expect(t.tags).toContainEqual(['parent', 'root1']);
  });

  it('edit-metadata omits the parent tag when none is given', () => {
    const t = buildEditGroupMetadataTemplate(ID, { name: 'x', isPublic: true, isOpen: true });
    expect(t.tags.some((tag) => tag[0] === 'parent')).toBe(false);
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

describe('publishToGroupRelay against a stale-signature guard (groups.edufeed.org pyramid)', () => {
  // The pyramid rejects moderation actions (9000-9009) whose created_at is
  // more than 60s old ("too old"). A NIP-46 bunker approval can take longer
  // than that between template build and relay receipt — re-stamp and
  // re-sign once, then republish, instead of surfacing the raw rejection.

  it('re-stamps created_at and republishes once after a "too old" rejection', async () => {
    user.signer.signEvent.mockClear();
    const relayConn = {
      publish: vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          message: 'moderation action is too old (older than 1 minute ago)'
        })
        .mockResolvedValueOnce({ ok: true })
    };
    await publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user);
    expect(relayConn.publish).toHaveBeenCalledTimes(2);
    const [firstSigned] = user.signer.signEvent.mock.calls[0];
    const [secondSigned] = user.signer.signEvent.mock.calls[1];
    expect(secondSigned.created_at).toBeGreaterThanOrEqual(firstSigned.created_at);
  });

  it('resolves with the re-signed event after the stale retry succeeds', async () => {
    const relayConn = {
      publish: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, message: 'too old, try again' })
        .mockResolvedValueOnce({ ok: true })
    };
    const signed = await publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user);
    expect(signed.id).toBe('signed');
  });

  it('does not loop — throws after exactly one retry when the relay keeps rejecting as too old', async () => {
    const relayConn = {
      publish: vi.fn(async () => ({ ok: false, message: 'moderation action is too old' }))
    };
    await expect(
      publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user)
    ).rejects.toThrow(/too old/i);
    // One initial attempt + exactly one retry — never a third call.
    expect(relayConn.publish).toHaveBeenCalledTimes(2);
  });
});

describe('isRelayMembershipRequired', () => {
  it('matches the pyramid whitelist rejection', () => {
    expect(
      isRelayMembershipRequired(
        new Error('restricted: only members of this relay can create a group')
      )
    ).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(
      isRelayMembershipRequired(new Error('Only Members Of This Relay Can Create A Group'))
    ).toBe(true);
  });

  it('does not match unrelated rejections', () => {
    expect(isRelayMembershipRequired(new Error('restricted: no'))).toBe(false);
    expect(isRelayMembershipRequired(new Error('moderation action is too old'))).toBe(false);
    expect(isRelayMembershipRequired(new Error('Timeout'))).toBe(false);
  });

  it('handles non-Error inputs without throwing', () => {
    expect(isRelayMembershipRequired(undefined)).toBe(false);
    expect(isRelayMembershipRequired('only members of this relay can create a group')).toBe(true);
  });
});

describe('publishToGroupRelay against held-until-auth relays (groups.0xchat.com)', () => {
  // Measured live 2026-08-14: 0xchat presents the NIP-42 challenge on connect
  // and silently HOLDS every OK until the client authenticates — it never
  // sends an auth-required NAK, so applesauce's publish resolves
  // {ok:false, message:'Timeout'} after 10s instead.

  it('answers a challenge that arrives while the publish is in flight', async () => {
    vi.mocked(authenticateOnce).mockClear();
    const { BehaviorSubject } = await import('rxjs');
    const relayConn = {
      challenge$: new BehaviorSubject('a-challenge'),
      authenticated: false,
      publish: vi.fn(async () => ({ ok: true }))
    };
    await publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user);
    expect(authenticateOnce).toHaveBeenCalledWith(relayConn, user.signer);
  });

  it('retries exactly once after a Timeout NAK when auth succeeds', async () => {
    vi.mocked(authenticateOnce).mockClear();
    const relayConn = {
      publish: vi
        .fn()
        .mockResolvedValueOnce({ ok: false, message: 'Timeout' })
        .mockResolvedValueOnce({ ok: true })
    };
    await publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user);
    expect(authenticateOnce).toHaveBeenCalledOnce();
    expect(relayConn.publish).toHaveBeenCalledTimes(2);
  });

  it('still throws Timeout when authentication cannot help', async () => {
    vi.mocked(authenticateOnce).mockClear();
    vi.mocked(authenticateOnce).mockResolvedValueOnce({ ok: false, message: 'no challenge' });
    const relayConn = { publish: vi.fn(async () => ({ ok: false, message: 'Timeout' })) };
    await expect(
      publishToGroupRelay(relayConn, buildDeleteGroupTemplate(ID), user)
    ).rejects.toThrow('Timeout');
    expect(relayConn.publish).toHaveBeenCalledOnce();
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
    // The 9007 must carry the metadata too — name-validating relays (buzz)
    // reject a bare create.
    expect(relayConn.publish.mock.calls[0][0].tags).toContainEqual(['name', 'X']);
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

describe('confirmGroupAdmins', () => {
  it('resolves the kind 39001 admins event for the group id', async () => {
    const adminsEvent = { kind: 39001, tags: [['p', PK, 'admin']] };
    const relayConn = { request: vi.fn(() => of(adminsEvent)) };
    const result = await confirmGroupAdmins(relayConn, ID);
    expect(relayConn.request).toHaveBeenCalledWith(
      { kinds: [39001], '#d': [ID] },
      { timeout: 8000 }
    );
    expect(result).toBe(adminsEvent);
  });

  it('resolves null when the relay has no 39001 for this id', async () => {
    const relayConn = { request: vi.fn(() => EMPTY) };
    const result = await confirmGroupAdmins(relayConn, ID);
    expect(result).toBeNull();
  });

  it('integration: the resolved event parses via getGroupAdmins to list the admin pubkey', async () => {
    // Real confirmGroupAdmins + real getGroupAdmins together — the shape a
    // bug in the request wiring (wrong filter key, wrong operator) would
    // otherwise slip past a fully-mocked provisionRootGroup test suite.
    const adminsEvent = { kind: 39001, tags: [['p', PK, 'admin']] };
    const relayConn = { request: vi.fn(() => of(adminsEvent)) };
    const result = await confirmGroupAdmins(relayConn, ID);
    expect(getGroupAdmins(/** @type {any} */ (result))).toEqual([{ pubkey: PK, roles: ['admin'] }]);
  });
});

describe('invite-code generation', () => {
  it('generateInviteCode yields 12 alphanumeric chars from unambiguous alphabet', async () => {
    const { generateInviteCode } = await import('$lib/groups/group-management.js');
    const code = generateInviteCode();
    expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz]{12}$/);
    // Verify uniqueness-ish
    expect(generateInviteCode()).not.toBe(code);
  });

  it('buildCreateInviteTemplate is kind 9009 with code tag', async () => {
    const { buildCreateInviteTemplate } = await import('$lib/groups/group-management.js');
    const code = 'ABC12345DEF6';
    const t = buildCreateInviteTemplate(ID, code);
    expect(t.kind).toBe(9009);
    expect(t.content).toBe('');
    expect(t.created_at).toBeTypeOf('number');
    expect(t.tags).toEqual([
      ['h', ID],
      ['code', code]
    ]);
  });
});
