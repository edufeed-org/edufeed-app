// @ts-nocheck
/** @vitest-environment node */
/**
 * Call host roles (issues "Video-Call: host role" + "mute other
 * participants"): the group relay writes a member seat's role into its
 * LiveKit participant metadata and exposes a NIP-98 moderation endpoint;
 * the client reads the one and calls the other. Co-hosts of a scheduled
 * meeting come from the NIP-52 `p`-tag role (meeting-roles.js).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  isGuestParticipant,
  isHostParticipant,
  isCohostParticipant,
  participantCallRole,
  livekitModerateUrl,
  moderateCall,
  GroupCallModerationError,
  CALL_MODERATION_ACTIONS
} = await import('$lib/groups/livekit.js');
const { COHOST_ROLE, isCohostRole, withCohostRole, meetingCohosts } = await import(
  '$lib/groups/meeting-roles.js'
);

const HEX = 'a'.repeat(64);

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('participant role from metadata', () => {
  it('reads {"host":true} and {"cohost":true}', () => {
    expect(isHostParticipant({ metadata: '{"host":true}' })).toBe(true);
    expect(isCohostParticipant({ metadata: '{"host":true}' })).toBe(false);
    expect(participantCallRole({ metadata: '{"host":true}' })).toBe('host');
    expect(isCohostParticipant({ metadata: '{"cohost":true}' })).toBe(true);
    expect(isHostParticipant({ metadata: '{"cohost":true}' })).toBe(false);
    expect(participantCallRole({ metadata: '{"cohost":true}' })).toBe('cohost');
  });

  it('is null for a plain seat, a revoked role ({}), a guest, garbage and no participant', () => {
    expect(participantCallRole({ metadata: '' })).toBeNull();
    expect(participantCallRole({ metadata: '{}' })).toBeNull();
    expect(participantCallRole({ metadata: '{"guest":true,"pass":"p"}' })).toBeNull();
    expect(participantCallRole({ metadata: 'not json' })).toBeNull();
    expect(participantCallRole({ metadata: '"host"' })).toBeNull();
    expect(participantCallRole(null)).toBeNull();
    expect(participantCallRole(undefined)).toBeNull();
    expect(isGuestParticipant({ metadata: '{"host":true}' })).toBe(false);
  });
});

describe('moderateCall', () => {
  const pointer = { id: 'g1', relay: 'wss://groups.edufeed.org/c/root' };
  const user = {
    pubkey: HEX,
    signer: { signEvent: vi.fn(async (draft) => ({ ...draft, id: 'id', sig: 'sig' })) }
  };

  it('builds the endpoint next to the token URL', () => {
    expect(livekitModerateUrl('wss://groups.edufeed.org/c/root', 'g1')).toBe(
      'https://groups.edufeed.org/.well-known/nip29/livekit/g1/moderate'
    );
    expect(livekitModerateUrl('garbage', 'g1')).toBeNull();
  });

  it('POSTs {action, identity} with a NIP-98 header bound to the URL, the method and the body hash', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => '{"ok":true}'
    }));
    vi.stubGlobal('fetch', fetchMock);

    await moderateCall(pointer, user, { action: 'mute', identity: `${HEX}:x1` });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://groups.edufeed.org/.well-known/nip29/livekit/g1/moderate');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ action: 'mute', identity: `${HEX}:x1` });
    const signed = JSON.parse(atob(opts.headers.Authorization.slice('Nostr '.length)));
    expect(signed.kind).toBe(27235);
    expect(signed.pubkey).toBe(HEX);
    expect(signed.tags).toContainEqual(['u', url]);
    expect(signed.tags).toContainEqual(['method', 'POST']);
    const payload = signed.tags.find((t) => t[0] === 'payload');
    expect(payload?.[1]).toMatch(/^[0-9a-f]{64}$/);
    // the hash is of the exact body bytes sent
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(opts.body));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(payload[1]).toBe(hex);
  });

  it("surfaces the relay's refusal as the error message with its status", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        text: async () => 'only the host may change roles\n'
      }))
    );
    const err = await moderateCall(pointer, user, {
      action: 'make-cohost',
      identity: `${HEX}:x1`
    }).catch((e) => e);
    expect(err).toBeInstanceOf(GroupCallModerationError);
    expect(err.message).toBe('only the host may change roles');
    expect(err.status).toBe(403);
  });

  it('maps a network failure to a GroupCallModerationError without status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    const err = await moderateCall(pointer, user, { action: 'remove', identity: 'x' }).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(GroupCallModerationError);
    expect(err.status).toBeUndefined();
  });

  it('rejects an unparseable relay url without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      moderateCall({ id: 'g', relay: 'nope' }, user, { action: 'mute', identity: 'x' })
    ).rejects.toBeInstanceOf(GroupCallModerationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('knows the six relay actions', () => {
    expect([...CALL_MODERATION_ACTIONS]).toEqual([
      'mute',
      'stop-video',
      'stop-screen',
      'remove',
      'make-cohost',
      'revoke-cohost'
    ]);
  });
});

describe('meeting co-host roles (NIP-52 p-tag role slot)', () => {
  it('co-host, moderator and organizer count; attendee, speaker, participant do not', () => {
    for (const role of ['co-host', 'Co-Host', 'cohost', 'moderator', 'organizer', ' Organizer ']) {
      expect(isCohostRole(role)).toBe(true);
    }
    for (const role of ['attendee', 'speaker', 'participant', '', undefined, null, 'host']) {
      expect(isCohostRole(role)).toBe(false);
    }
  });

  it('withCohostRole writes the explicit role and clears it again (presets included)', () => {
    const p = { pubkey: HEX, relay: 'wss://r' };
    expect(withCohostRole(p, true)).toEqual({ pubkey: HEX, relay: 'wss://r', role: COHOST_ROLE });
    expect(withCohostRole({ ...p, role: 'co-host' }, false)).toEqual(p);
    expect(withCohostRole({ ...p, role: 'moderator' }, false)).toEqual(p);
    expect(withCohostRole({ ...p, role: 'speaker' }, true).role).toBe('co-host');
  });

  it('meetingCohosts lists the p-tagged co-hosts once, never the author, never a bad pubkey', () => {
    const B = 'b'.repeat(64);
    const C = 'c'.repeat(64);
    const event = {
      pubkey: HEX,
      tags: [
        ['p', B, '', 'co-host'],
        ['p', B, '', 'moderator'],
        ['p', C.toUpperCase(), 'wss://r', 'organizer'],
        ['p', HEX, '', 'co-host'],
        ['p', 'd'.repeat(64), '', 'attendee'],
        ['p', 'not-a-key', '', 'co-host'],
        ['participant', 'Name', '', 'co-host']
      ]
    };
    expect(meetingCohosts(event)).toEqual([B, C]);
    expect(meetingCohosts(null)).toEqual([]);
  });
});
