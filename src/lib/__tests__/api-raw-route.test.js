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

/** @param {number} kind @param {string} [pubkey] */
const naddrOf = (kind, pubkey = PK) => nip19.naddrEncode({ kind, pubkey, identifier: 'kurs' });
/** @param {string} naddr */
const get = (naddr) => GET(/** @type {any} */ ({ params: { naddr } }));
/** @param {() => unknown} fn */
async function status(fn) {
  try {
    await fn();
  } catch (/** @type {any} */ e) {
    return e.status;
  }
  return 200;
}

const EVENT = {
  kind: 30023,
  pubkey: PK,
  tags: [
    ['d', 'kurs'],
    ['title', 'Kurs']
  ],
  content: 'Inhalt'
};

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
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
    const body = await res.text();
    expect(body.startsWith('<!--\nauthor: ')).toBe(true);
    expect(body.endsWith('# Kurs\n\nInhalt')).toBe(true);
  });

  it('serves drafts (30024) too', async () => {
    fetchMock.mockResolvedValue({ event: { ...EVENT, kind: 30024 }, complete: true });
    expect((await get(naddrOf(30024))).status).toBe(200);
  });

  it('404s other kinds, junk and blocked authors without asking a relay', async () => {
    expect(await status(() => get(naddrOf(30818)))).toBe(404);
    expect(await status(() => get('nope.md'))).toBe(404);
    expect(await status(() => get(naddrOf(30023, BLOCKED)))).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('404s a confirmed miss, 503s when the relays did not answer', async () => {
    fetchMock.mockResolvedValue({ event: null, complete: true });
    expect(await status(() => get(naddrOf(30023)))).toBe(404);
    fetchMock.mockResolvedValue({ event: null, complete: false });
    expect(await status(() => get(naddrOf(30023)))).toBe(503);
  });
});
