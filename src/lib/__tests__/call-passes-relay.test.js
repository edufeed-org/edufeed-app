// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of, throwError } from 'rxjs';

const publishToGroupRelay = vi.fn(async (_relay, template, user) => ({
  ...template,
  pubkey: user.pubkey,
  id: 'pass-id'
}));
vi.mock('$lib/groups/group-management.js', async (orig) => ({
  ...(await orig()),
  publishToGroupRelay: (...a) => publishToGroupRelay(...a)
}));
const authenticateOnce = vi.fn(async () => ({ ok: true }));
vi.mock('$lib/groups/relay-auth.js', async (orig) => ({
  ...(await orig()),
  authenticateOnce: (...a) => authenticateOnce(...a)
}));

const {
  createCallLink,
  createMeetingLink,
  renewMeetingLink,
  listCallPasses,
  passLinkFor,
  revokeCallPass,
  hashPassCode,
  callLinkUrl,
  CALL_PASS_KIND
} = await import('$lib/groups/call-passes.js');

const ME = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const POINTER = { id: 'g1', relay: 'wss://groups.example/' };
const signer = {
  signEvent: vi.fn(async (d) => d),
  nip44: {
    encrypt: vi.fn(async (_pk, text) => `enc:${text}`),
    decrypt: vi.fn(async (_pk, c) => c.replace(/^enc:/, ''))
  }
};
const USER = { pubkey: ME, signer };
const relayConn = { url: POINTER.relay };

beforeEach(() => {
  publishToGroupRelay.mockClear();
  authenticateOnce.mockClear();
  vi.useRealTimers();
});

describe('createCallLink', () => {
  it('publishes a self-encrypted, call-scoped pass expiring in 12 h', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000_000 * 1000));
    const { code, url } = await createCallLink(relayConn, POINTER, USER, 'https://app.example');
    const template = publishToGroupRelay.mock.calls[0][1];
    expect(template.kind).toBe(CALL_PASS_KIND);
    expect(template.content).toBe(`enc:${code}`);
    expect(signer.nip44.encrypt).toHaveBeenCalledWith(ME, code);
    expect(template.tags).toContainEqual(['expiration', String(1_000_000 + 12 * 3600)]);
    expect(template.tags).toContainEqual(['scope', 'call']);
    expect(template.tags.find((t) => t[0] === 'code-hash')[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(url.startsWith('https://app.example/call/')).toBe(true);
    expect(url.endsWith(`#${code}`)).toBe(true);
  });
  it('passes an optional link name through as a title tag', async () => {
    await createCallLink(relayConn, POINTER, USER, 'https://app.example', {
      title: 'Elternabend'
    });
    expect(publishToGroupRelay.mock.calls[0][1].tags).toContainEqual(['title', 'Elternabend']);
  });
  it('refuses a signer without NIP-44 before publishing anything', async () => {
    await expect(
      createCallLink(
        relayConn,
        POINTER,
        { pubkey: ME, signer: { signEvent: vi.fn() } },
        'https://x'
      )
    ).rejects.toThrow('nip44-unsupported');
    expect(publishToGroupRelay).not.toHaveBeenCalled();
  });
});

describe('createMeetingLink', () => {
  const MEETING = {
    start: 2_000_000,
    end: 2_003_600,
    coordinate: `31923:${ME}:meeting-1`,
    title: 'Elternabend'
  };

  it('publishes a self-encrypted pass windowed around the meeting, not call-scoped', async () => {
    const { code, url } = await createMeetingLink(
      relayConn,
      POINTER,
      USER,
      'https://app.example',
      MEETING
    );
    const template = publishToGroupRelay.mock.calls[0][1];
    expect(publishToGroupRelay.mock.calls[0][0]).toBe(relayConn);
    expect(template.kind).toBe(CALL_PASS_KIND);
    expect(template.content).toBe(`enc:${code}`);
    expect(template.tags.filter((t) => t[0] === 'h')).toEqual([['h', 'g1']]);
    expect(template.tags).toContainEqual(['not-before', String(2_000_000 - 900)]);
    expect(template.tags).toContainEqual(['expiration', String(2_003_600 + 1800)]);
    expect(template.tags).toContainEqual(['a', MEETING.coordinate, POINTER.relay]);
    expect(template.tags).toContainEqual(['title', 'Elternabend']);
    expect(template.tags.find((t) => t[0] === 'scope')).toBeUndefined();
    expect(url.startsWith('https://app.example/call/')).toBe(true);
    expect(url.endsWith(`#${code}`)).toBe(true);
  });

  it('refuses a signer without NIP-44 before publishing anything', async () => {
    await expect(
      createMeetingLink(
        relayConn,
        POINTER,
        { pubkey: ME, signer: { signEvent: vi.fn() } },
        'https://x',
        MEETING
      )
    ).rejects.toThrow('nip44-unsupported');
    expect(publishToGroupRelay).not.toHaveBeenCalled();
  });
});

describe('listCallPasses', () => {
  it('authenticates, then returns unexpired passes newest first', async () => {
    const now = Math.floor(Date.now() / 1000);
    const pass = (id, created_at, expiration) => ({
      id,
      kind: 9025,
      pubkey: ME,
      created_at,
      content: '',
      tags: [
        ['h', 'g1'],
        ['expiration', String(expiration)]
      ]
    });
    const conn = {
      url: POINTER.relay,
      request: vi.fn(() =>
        of(
          pass('old', now - 50, now + 60),
          pass('new', now - 10, now + 60),
          pass('gone', now - 5, now - 1)
        )
      )
    };
    const list = await listCallPasses(conn, 'g1', USER);
    expect(authenticateOnce).toHaveBeenCalledWith(conn, signer);
    // Real applesauce-relay API: Relay#request(filter, { timeout }) — a
    // single filter object plus a timeout option, not an array of filters.
    expect(conn.request).toHaveBeenCalledWith({ kinds: [9025], '#h': ['g1'] }, { timeout: 5000 });
    expect(list.map((p) => p.id)).toEqual(['new', 'old']);
  });

  it('rejects when the relay errors or times out, rather than reading it as empty', async () => {
    const conn = {
      url: POINTER.relay,
      request: vi.fn(() => throwError(() => new Error('boom')))
    };
    await expect(listCallPasses(conn, 'g1', USER)).rejects.toThrow('boom');
  });
});

describe('passLinkFor', () => {
  it('rebuilds the link of my own pass, nothing for someone else’s', async () => {
    const mine = { pubkey: ME, content: 'enc:' + 'C'.repeat(22) };
    expect(await passLinkFor(mine, USER, POINTER, 'https://x')).toMatch(/#C{22}$/);
    expect(await passLinkFor({ ...mine, pubkey: OTHER }, USER, POINTER, 'https://x')).toBeNull();
    expect(
      await passLinkFor({ pubkey: ME, content: 'enc:short' }, USER, POINTER, 'https://x')
    ).toBeNull();
  });
});

describe('revokeCallPass', () => {
  it('author revokes with a kind 5 carrying e, h and k', async () => {
    await revokeCallPass(relayConn, { id: 'p1', pubkey: ME, tags: [['h', 'g1']] }, USER);
    const t = publishToGroupRelay.mock.calls[0][1];
    expect(t.kind).toBe(5);
    expect(t.tags).toEqual([
      ['e', 'p1'],
      ['h', 'g1'],
      ['k', '9025']
    ]);
  });
  it('an admin revokes someone else’s pass with a 9005', async () => {
    await revokeCallPass(relayConn, { id: 'p2', pubkey: OTHER, tags: [['h', 'g1']] }, USER, {
      asAdmin: true
    });
    const t = publishToGroupRelay.mock.calls[0][1];
    expect(t.kind).toBe(9005);
    expect(t.tags).toEqual([
      ['h', 'g1'],
      ['e', 'p2']
    ]);
  });
  it('a non-admin cannot revoke someone else’s pass', async () => {
    await expect(
      revokeCallPass(relayConn, { id: 'p3', pubkey: OTHER, tags: [['h', 'g1']] }, USER)
    ).rejects.toThrow();
    expect(publishToGroupRelay).not.toHaveBeenCalled();
  });
});

// A reschedule must not break a guest link that was already shared: the
// relay freezes not-before/expiration into the pass at mint time (pyramid
// call_pass.go `status()` never reads the meeting), so the pass is minted
// again with the SAME code (the URL stays) and the new window, and the old
// pass is revoked.
describe('renewMeetingLink', () => {
  const CODE = 'C'.repeat(22);
  const MEETING = {
    start: 3_000_000,
    end: 3_003_600,
    coordinate: `31923:${ME}:meeting-1`,
    title: 'Elternabend (neu)'
  };
  const oldPass = {
    id: 'old-pass',
    kind: CALL_PASS_KIND,
    pubkey: ME,
    content: `enc:${CODE}`,
    tags: [
      ['h', 'g1'],
      ['code-hash', 'f'.repeat(64)],
      ['expiration', '2005400'],
      ['not-before', '1999100'],
      ['a', MEETING.coordinate, POINTER.relay]
    ]
  };

  it('re-mints the pass with the same code and the new window, then revokes the old one', async () => {
    const signed = async (_relay, template, user) => ({
      ...template,
      pubkey: user.pubkey,
      id: template.kind === CALL_PASS_KIND ? 'new-pass' : 'deletion'
    });
    publishToGroupRelay.mockImplementationOnce(signed).mockImplementationOnce(signed);
    const { code, url, event, revoked, sameCode } = await renewMeetingLink(
      relayConn,
      POINTER,
      USER,
      'https://app.example',
      oldPass,
      MEETING
    );
    expect(sameCode).toBe(true);
    expect(code).toBe(CODE);
    expect(url).toBe(callLinkUrl('https://app.example', POINTER, CODE));

    expect(publishToGroupRelay).toHaveBeenCalledTimes(2);
    const [, template] = publishToGroupRelay.mock.calls[0];
    expect(template.kind).toBe(CALL_PASS_KIND);
    expect(template.content).toBe(`enc:${CODE}`);
    expect(template.tags).toContainEqual(['code-hash', await hashPassCode(CODE)]);
    expect(template.tags).toContainEqual(['not-before', String(3_000_000 - 900)]);
    expect(template.tags).toContainEqual(['expiration', String(3_003_600 + 1800)]);
    expect(template.tags).toContainEqual(['a', MEETING.coordinate, POINTER.relay]);
    expect(template.tags).toContainEqual(['title', 'Elternabend (neu)']);
    expect(template.tags.filter((t) => t[0] === 'h')).toEqual([['h', 'g1']]);
    expect(event.id).toBe('new-pass');

    // The old pass goes second: the link never stops working in between.
    const [, deletion] = publishToGroupRelay.mock.calls[1];
    expect(deletion.kind).toBe(5);
    expect(deletion.tags).toContainEqual(['e', 'old-pass']);
    expect(revoked?.id).toBe('deletion');
  });

  it('falls back to a fresh code when the old one cannot be read, and says so', async () => {
    const { code, sameCode } = await renewMeetingLink(
      relayConn,
      POINTER,
      USER,
      'https://app.example',
      { ...oldPass, content: 'enc:garbage' },
      MEETING
    );
    expect(sameCode).toBe(false);
    expect(code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(publishToGroupRelay).toHaveBeenCalledTimes(2);
  });

  it('keeps the new pass when revoking the old one fails (the link works either way)', async () => {
    publishToGroupRelay
      .mockImplementationOnce(async (_r, template, user) => ({
        ...template,
        pubkey: user.pubkey,
        id: 'new-pass'
      }))
      .mockRejectedValueOnce(new Error('auth-required'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { event, revoked } = await renewMeetingLink(
      relayConn,
      POINTER,
      USER,
      'https://app.example',
      oldPass,
      MEETING
    );
    expect(event.id).toBe('new-pass');
    expect(revoked).toBeNull();
    warn.mockRestore();
  });

  it("refuses someone else's pass and a signer without NIP-44", async () => {
    await expect(
      renewMeetingLink(
        relayConn,
        POINTER,
        USER,
        'https://x',
        { ...oldPass, pubkey: OTHER },
        MEETING
      )
    ).rejects.toThrow();
    await expect(
      renewMeetingLink(
        relayConn,
        POINTER,
        { pubkey: ME, signer: { signEvent: vi.fn() } },
        'https://x',
        oldPass,
        MEETING
      )
    ).rejects.toThrow('nip44-unsupported');
    expect(publishToGroupRelay).not.toHaveBeenCalled();
  });
});
