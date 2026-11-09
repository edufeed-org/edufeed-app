/** @vitest-environment node */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';

const PK = '1c5ff3caacd842c01dca8f378231b16617516d214da75c7aeabbe9e1efe9c0f6';
const BLOCKED = 'f'.repeat(64);

vi.mock('$env/dynamic/private', () => ({ env: { BLOCKED_PUBKEYS: BLOCKED } }));

const fetchMock = vi.fn();
vi.mock('$lib/server/relay-fetch.js', async (orig) => ({
  .../** @type {object} */ (await orig()),
  fetchEventResultFromRelays: (/** @type {string} */ id) => fetchMock(id)
}));

const { GET } = await import('../../routes/api/raw/[naddr]/+server.js');

let n = 0;
/** A fresh d-tag per call: the endpoint caches by naddr. @param {number} kind @param {string} [pubkey] */
const naddrOf = (kind, pubkey = PK) =>
  nip19.naddrEncode({ kind, pubkey, identifier: `kurs-${++n}` });
/** @param {string} naddr @param {string} [ip] */
const get = (naddr, ip = '10.0.0.1') =>
  GET(/** @type {any} */ ({ params: { naddr }, getClientAddress: () => ip }));

const EVENT = {
  kind: 30023,
  pubkey: PK,
  tags: [
    ['d', 'kurs'],
    ['title', 'Kurs']
  ],
  content: 'Inhalt'
};

/** Every answer, errors included, is CORS-open and noindex. @param {Response} res */
function expectHeaders(res) {
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  expect(res.headers.get('x-robots-tag')).toBe('noindex');
}

describe('GET /api/raw/[naddr]', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ event: EVENT, complete: true });
  });

  it('serves an article as LiaScript markdown, CORS-open, with a .md suffix', async () => {
    const naddr = naddrOf(30023);
    const res = await get(`${naddr}.md`);
    expect(fetchMock).toHaveBeenCalledWith(naddr);
    expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    expectHeaders(res);
    const body = await res.text();
    expect(body.startsWith('<!--\nauthor: ')).toBe(true);
    expect(body.endsWith('# Kurs\n\nInhalt')).toBe(true);
  });

  it('serves drafts (30024) too', async () => {
    fetchMock.mockResolvedValue({ event: { ...EVENT, kind: 30024 }, complete: true });
    expect((await get(naddrOf(30024), '10.0.0.2')).status).toBe(200);
  });

  it('404s other kinds, junk and blocked authors without asking a relay', async () => {
    for (const naddr of [naddrOf(30818), 'nope.md', naddrOf(30023, BLOCKED)]) {
      const res = await get(naddr, '10.0.0.3');
      expect(res.status).toBe(404);
      expectHeaders(res);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s a confirmed miss, 503s when the relays did not answer', async () => {
    fetchMock.mockResolvedValue({ event: null, complete: true });
    expect((await get(naddrOf(30023), '10.0.0.4')).status).toBe(404);
    fetchMock.mockResolvedValue({ event: null, complete: false });
    expect((await get(naddrOf(30023), '10.0.0.4')).status).toBe(503);
  });

  it('413s content over 300 000 characters', async () => {
    fetchMock.mockResolvedValue({
      event: { ...EVENT, content: 'a'.repeat(300_001) },
      complete: true
    });
    const res = await get(naddrOf(30023), '10.0.0.5');
    expect(res.status).toBe(413);
    expectHeaders(res);
  });

  it('answers a repeat hit from its cache, without asking the relays again', async () => {
    const naddr = naddrOf(30023);
    await get(naddr, '10.0.0.6');
    const res = await get(`${naddr}.md`, '10.0.0.6');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Inhalt');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('429s the 31st request per minute from one address', async () => {
    const naddr = naddrOf(30023);
    for (let i = 0; i < 30; i++) expect((await get(naddr, '10.0.0.7')).status).toBe(200);
    const res = await get(naddr, '10.0.0.7');
    expect(res.status).toBe(429);
    expectHeaders(res);
    expect((await get(naddr, '10.0.0.8')).status).toBe(200);
  });
});
