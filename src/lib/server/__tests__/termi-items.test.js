/** @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  safeUrl,
  normalizeContent,
  normalizeEvent,
  normalizePerson,
  normalizeCommunity,
  normalizePassage
} from '../termi/items.js';
import searchContent from './fixtures/nope-mcp/search_content.json';
import searchResources from './fixtures/nope-mcp/search_resources.json';
import calendar from './fixtures/nope-mcp/search_calendar_events.json';
import passages from './fixtures/nope-mcp/search_passages.json';
import resolveAuthor from './fixtures/nope-mcp/resolve_author.json';
import findCommunity from './fixtures/nope-mcp/find_community.2a.json';

const QUERIED = searchContent.relaysSearched;

/** @param {string} href */
function hintsOf(href) {
  const decoded = nip19.decode(href.slice(1));
  if (decoded.type !== 'naddr') throw new Error('not an naddr');
  return decoded.data;
}

describe('safeUrl', () => {
  it('keeps absolute http(s) URLs only', () => {
    expect(safeUrl('https://example.org/a')).toBe('https://example.org/a');
    expect(safeUrl('http://example.org/')).toBe('http://example.org/');
    expect(safeUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeUrl('data:text/html,x')).toBeUndefined();
    expect(safeUrl('/relative')).toBeUndefined();
    expect(safeUrl(undefined)).toBeUndefined();
    expect(safeUrl(42)).toBeUndefined();
  });
});

describe('normalizeContent', () => {
  const [scored, unscored, article] = searchContent.results;

  it('maps a recorded search_content hit to a resource item', () => {
    const item = normalizeContent(scored, QUERIED);
    expect(item).toMatchObject({
      type: 'resource',
      title: 'Durchlässigkeit im Bildungssystem',
      license: 'CC BY-SA 4.0',
      creator: 'BIBB, Christian Vogel',
      publisher: 'BIBB | Publikationen',
      sourceUrl: 'https://download.sodix.de/api/content/data/SODIX-0001130042.pdf',
      score: scored.score
    });
    expect(item?.description?.length).toBeLessThanOrEqual(300);
    expect(item?.weak).toBeUndefined();
  });

  it('re-encodes the naddr with the queried relays when the hit has no relay (old shape)', () => {
    const item = normalizeContent(unscored, QUERIED);
    const original = /** @type {any} */ (nip19.decode(unscored.naddr)).data;
    const data = hintsOf(/** @type {string} */ (item?.href));
    expect(data).toMatchObject({
      kind: original.kind,
      pubkey: original.pubkey,
      identifier: original.identifier
    });
    expect(data.relays).toEqual(QUERIED);
    expect(item?.id).toBe(`${original.kind}:${original.pubkey}:${original.identifier}`);
  });

  it('uses the hit relay as the only hint when present (2a shape)', () => {
    const item = normalizeContent({ ...article, relay: 'wss://oersi.edufeed.org' }, QUERIED);
    expect(hintsOf(/** @type {string} */ (item?.href)).relays).toEqual(['wss://oersi.edufeed.org']);
    expect(item?.relay).toBe('wss://oersi.edufeed.org');
    expect(item?.picture).toBe(article.image);
  });

  it('maps a search_resources resource (naddr under nostr)', () => {
    const r = searchResources.resources[0];
    const item = normalizeContent(r, searchResources.relaysSearched);
    expect(item?.title).toBe(r.name);
    expect(item?.license).toBe('CC BY 4.0');
    expect(hintsOf(/** @type {string} */ (item?.href)).identifier).toBe('https://digi4all.de');
  });

  it('marks a hit with lexical 0 and no score as weak', () => {
    expect(normalizeContent({ ...unscored, lexical: 0 }, QUERIED)?.weak).toBe(true);
    expect(normalizeContent({ ...scored, lexical: 0 }, QUERIED)?.weak).toBeUndefined();
    expect(normalizeContent({ ...unscored, lexical: 0.5 }, QUERIED)?.weak).toBeUndefined();
  });

  it('drops a hit whose naddr does not decode', () => {
    expect(normalizeContent({ ...scored, naddr: 'naddr1garbage' }, QUERIED)).toBeUndefined();
    expect(normalizeContent({ ...scored, naddr: undefined }, QUERIED)).toBeUndefined();
  });

  it('drops unsafe source and picture links', () => {
    const item = normalizeContent(
      { ...article, sourcePage: 'javascript:alert(1)', image: 'javascript:x' },
      QUERIED
    );
    expect(item?.sourceUrl).toBeUndefined();
    expect(item?.picture).toBeUndefined();
  });
});

describe('normalizeEvent', () => {
  it('maps a recorded calendar event, href = path of the nope-mcp url', () => {
    const ev = calendar.events[0];
    const item = normalizeEvent(ev);
    expect(item).toMatchObject({
      type: 'event',
      title: ev.title,
      href: `/${ev.naddr}`,
      date: ev.start,
      location: ev.locations[0],
      creator: 'Deutscher Bildungsserver Test-Mirror',
      bot: true,
      sourceUrl: ev.sourcePage,
      end: ev.end,
      allDay: false
    });
    expect(item?.description?.length).toBeLessThanOrEqual(300);
  });

  it('never turns a //host path into an href', () => {
    const ev = calendar.events[0];
    const item = normalizeEvent({
      ...ev,
      url: 'https://edufeed.org//evil.example/x',
      naddr: undefined
    });
    expect(item?.href).toBeUndefined();
    expect(item?.sourceUrl).toBe(ev.sourcePage);
  });

  it('drops the href for a bogus naddr, keeps the item for its source', () => {
    const ev = calendar.events[0];
    const item = normalizeEvent({
      ...ev,
      url: 'https://edufeed.org/naddr1bogus',
      naddr: 'naddr1bogus'
    });
    expect(item?.href).toBeUndefined();
    expect(item?.sourceUrl).toBe(ev.sourcePage);
    expect(
      normalizeEvent({ ...ev, url: undefined, naddr: 'nope', sourcePage: undefined })
    ).toBeUndefined();
  });

  it('falls back to the naddr field when the url has none', () => {
    const ev = calendar.events[0];
    expect(normalizeEvent({ ...ev, url: 'https://edufeed.org/' })?.href).toBe(`/${ev.naddr}`);
  });
});

describe('line clipping', () => {
  it('clips titles and names at 200 chars', () => {
    const long = 'T'.repeat(500);
    const item = normalizeContent(
      {
        ...searchContent.results[0],
        title: long,
        creator: [{ name: long }],
        publisher: [{ name: long }]
      },
      QUERIED
    );
    expect(item?.title.length).toBe(200);
    expect(item?.creator?.length).toBe(200);
    expect(item?.publisher?.length).toBe(200);
    expect(normalizeCommunity({ ...findCommunity.communities[0], name: long })?.title.length).toBe(
      200
    );
  });
});

describe('normalizePerson', () => {
  it('maps a resolve_author candidate to /p/<npub>', () => {
    const c = resolveAuthor.candidates[1];
    expect(normalizePerson(c)).toMatchObject({
      type: 'person',
      id: c.pubkey,
      title: 'Laura K',
      subtitle: 'laura@example.org',
      href: `/p/${c.npub}`
    });
  });

  it('drops a candidate with a malformed npub or pubkey', () => {
    const c = resolveAuthor.candidates[1];
    expect(normalizePerson({ ...c, npub: 'npub1garbage' })).toBeUndefined();
    expect(normalizePerson({ ...c, pubkey: 'xyz' })).toBeUndefined();
    expect(normalizePerson({ ...c, npub: resolveAuthor.candidates[0].npub })).toBeUndefined();
  });
});

describe('normalizeCommunity', () => {
  it('maps a find_community result to /c/<npub>', () => {
    const c = findCommunity.communities[0];
    expect(normalizeCommunity(c)).toMatchObject({
      type: 'community',
      id: c.pubkey,
      title: c.name,
      description: c.description,
      picture: c.picture,
      relay: c.relay,
      href: `/c/${c.npub}`
    });
  });

  it('drops a community with a malformed npub or pubkey', () => {
    const c = findCommunity.communities[0];
    expect(normalizeCommunity({ ...c, npub: 'nsec1abc' })).toBeUndefined();
    expect(normalizeCommunity({ ...c, pubkey: 'A'.repeat(64) })).toBeUndefined();
  });
});

describe('normalizePassage', () => {
  it('maps a recorded passage; href is its source URL', () => {
    const p = passages.passages[0];
    expect(normalizePassage(p)).toMatchObject({
      type: 'passage',
      id: p.chunk_id,
      title: 'Der „Filter“',
      subtitle: 'Kurzbeschreibung',
      href: p.source_url,
      sourceUrl: p.source_url,
      license: 'BY-SA (KIM)',
      publisher: 'LEHRE LADEN',
      score: p.score
    });
  });

  it('drops a passage without a safe source URL', () => {
    expect(
      normalizePassage({ ...passages.passages[0], source_url: 'javascript:x' })
    ).toBeUndefined();
  });
});
