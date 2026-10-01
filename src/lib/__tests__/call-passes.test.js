// @ts-nocheck
/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  CALL_PASS_KIND,
  generatePassCode,
  hashPassCode,
  isPassCode,
  buildCallPassTemplate,
  callLinkUrl,
  readPassCodeFromHash,
  passCheckUrl,
  checkCallPass,
  probeCallPassSupport
} = await import('$lib/groups/call-passes.js');

const RELAY = 'wss://groups.example/';
const COMMUNITY_RELAY = 'wss://groups.example/c/root1/';

beforeEach(() => vi.unstubAllGlobals());

describe('codes', () => {
  it('generates 22-char base64url codes (128 bits)', () => {
    const a = generatePassCode();
    const b = generatePassCode();
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
    expect(isPassCode(a)).toBe(true);
  });
  it('rejects short, padded or foreign values', () => {
    expect(isPassCode('abc')).toBe(false);
    expect(isPassCode('a'.repeat(21))).toBe(false);
    expect(isPassCode('a'.repeat(21) + '=')).toBe(false);
    expect(isPassCode('a'.repeat(65))).toBe(false);
    expect(isPassCode(null)).toBe(false);
  });
  it('hashes to sha256 hex', async () => {
    // sha256("abc")
    expect(await hashPassCode('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });
});

describe('buildCallPassTemplate', () => {
  it('writes exactly one h tag and the required tags', () => {
    const t = buildCallPassTemplate({
      groupId: 'g1',
      codeHash: 'f'.repeat(64),
      encryptedCode: 'cipher',
      expiration: 2000,
      scopeCall: true
    });
    expect(t.kind).toBe(CALL_PASS_KIND);
    expect(t.content).toBe('cipher');
    expect(t.tags).toEqual([
      ['h', 'g1'],
      ['code-hash', 'f'.repeat(64)],
      ['expiration', '2000'],
      ['scope', 'call']
    ]);
  });
  it('adds not-before and the meeting a tag when given', () => {
    const t = buildCallPassTemplate({
      groupId: 'g1',
      codeHash: 'f'.repeat(64),
      encryptedCode: 'c',
      expiration: 2000,
      notBefore: 1000,
      meeting: ['31923:pk:d', 'wss://groups.example/']
    });
    expect(t.tags).toContainEqual(['not-before', '1000']);
    expect(t.tags).toContainEqual(['a', '31923:pk:d', 'wss://groups.example/']);
    expect(t.tags.filter((x) => x[0] === 'h')).toHaveLength(1);
    expect(t.tags.some((x) => x[0] === 'scope')).toBe(false);
  });
  it('adds a trimmed title tag, capped at 80 chars, only when non-empty', () => {
    const base = { groupId: 'g1', codeHash: 'f'.repeat(64), encryptedCode: 'c', expiration: 2000 };
    expect(buildCallPassTemplate({ ...base, title: '  Elternabend  ' }).tags).toContainEqual([
      'title',
      'Elternabend'
    ]);
    const long = buildCallPassTemplate({ ...base, title: 'x'.repeat(100) });
    expect(long.tags.find((t) => t[0] === 'title')[1]).toBe('x'.repeat(80));
    expect(
      buildCallPassTemplate({ ...base, title: '   ' }).tags.some((t) => t[0] === 'title')
    ).toBe(false);
    expect(buildCallPassTemplate(base).tags.some((t) => t[0] === 'title')).toBe(false);
  });
});

describe('links', () => {
  it('puts the code in the fragment, never the query', () => {
    const url = callLinkUrl('https://edufeed.org', { id: 'g1', relay: RELAY }, 'C'.repeat(22));
    expect(url.startsWith('https://edufeed.org/call/')).toBe(true);
    expect(url.endsWith('#' + 'C'.repeat(22))).toBe(true);
    expect(url).not.toContain('?');
  });
  it('reads a valid code back from location.hash', () => {
    expect(readPassCodeFromHash('#' + 'C'.repeat(22))).toBe('C'.repeat(22));
    expect(readPassCodeFromHash('')).toBeNull();
    expect(readPassCodeFromHash('#short')).toBeNull();
  });
  it('pass check URL lives at the relay origin', () => {
    expect(passCheckUrl(COMMUNITY_RELAY, 'g1', 'f'.repeat(64))).toBe(
      `https://groups.example/.well-known/nip29/livekit/g1/pass/${'f'.repeat(64)}`
    );
    expect(passCheckUrl('nope', 'g1', 'x')).toBeNull();
  });
});

describe('checkCallPass', () => {
  it('maps the relay JSON to camelCase', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              valid: true,
              reason: 'ok',
              expiration: 99,
              scope: 'call',
              name: 'Weekly',
              live_count: 3
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
      )
    );
    const r = await checkCallPass(RELAY, 'g1', 'C'.repeat(22));
    expect(r).toMatchObject({
      valid: true,
      reason: 'ok',
      expiration: 99,
      scope: 'call',
      name: 'Weekly',
      liveCount: 3
    });
  });
  it('reads a 404 / network failure / non-JSON as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 }))
    );
    expect((await checkCallPass(RELAY, 'g1', 'C'.repeat(22))).reason).toBe('unreachable');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    expect((await checkCallPass(RELAY, 'g1', 'C'.repeat(22))).reason).toBe('unreachable');
  });
  it('never treats an unknown reason string as valid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ valid: true, reason: 'weird' }), { status: 200 })
      )
    );
    const r = await checkCallPass(RELAY, 'g1', 'C'.repeat(22));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe('unknown');
  });
});

describe('probeCallPassSupport', () => {
  it('is true when the all-zero hash answers JSON', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ valid: false, reason: 'unknown', live_count: 0 }), {
          status: 200
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await probeCallPassSupport(RELAY, 'g1')).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain(`/pass/${'0'.repeat(64)}`);
  });
  it('is false on 404 (stock relay or non-AV group)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 }))
    );
    expect(await probeCallPassSupport(RELAY, 'g1')).toBe(false);
  });
});
