#!/usr/bin/env node
/**
 * Freeze the GEO experiment's page list: reads a deployment's /sitemap.xml and
 * prints one CSV row per URL with its kind, assignment key and group (T/V),
 * computed by the same function the server uses
 * (src/lib/server/geo/assignment.js). Run once at experiment start and keep
 * the file — later analysis only counts these pages.
 *
 *   node scripts/geo-experiment-snapshot.mjs https://edufeed.org 0.5 > snapshot.csv
 *   (optional 3rd argument: salt, default as on the server)
 */
import { nip19 } from 'nostr-tools';
import { DEFAULT_GEO_SALT, geoGroup } from '../src/lib/server/geo/assignment.js';

/**
 * @param {string} loc
 * @returns {{ kind: number | '', key: string } | null}
 */
export function keyForUrl(loc) {
  const { pathname } = new URL(loc);
  const wiki = pathname.match(/^\/wiki\/([^/]+)$/);
  if (wiki) return { kind: 30818, key: `wiki:${decodeURIComponent(wiki[1])}` };
  const naddr = pathname.match(/(naddr1[a-z0-9]+)/)?.[1];
  if (!naddr) return null;
  const decoded = nip19.decode(naddr);
  if (decoded.type !== 'naddr') return null;
  const { kind, pubkey, identifier } = decoded.data;
  // Same rule as geoContentKey: wiki articles are keyed by topic.
  return { kind, key: kind === 30818 ? `wiki:${identifier}` : `${kind}:${pubkey}:${identifier}` };
}

/** @param {string} value */
const csv = (value) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/**
 * @param {string} xml - sitemap
 * @param {number} share
 * @param {string} salt
 * @returns {string[]} CSV lines incl. header
 */
export function snapshotRows(xml, share, salt) {
  const rows = ['url,kind,key,group,lastmod'];
  for (const [, body] of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = body.match(/<loc>([^<]+)<\/loc>/)?.[1]?.replace(/&amp;/g, '&');
    if (!loc) continue;
    const lastmod = body.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] ?? '';
    const k = keyForUrl(loc);
    if (!k) continue;
    rows.push(
      [loc, String(k.kind), k.key, geoGroup(k.key, share, salt), lastmod].map(csv).join(',')
    );
  }
  return rows;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [origin, share = '0.5', salt = DEFAULT_GEO_SALT] = process.argv.slice(2);
  if (!origin) {
    console.error('usage: geo-experiment-snapshot.mjs <origin> [share] [salt]');
    process.exit(1);
  }
  const res = await fetch(new URL('/sitemap.xml', origin));
  if (!res.ok) {
    console.error(`sitemap: HTTP ${res.status}`);
    process.exit(1);
  }
  console.log(snapshotRows(await res.text(), Number(share), salt).join('\n'));
}
