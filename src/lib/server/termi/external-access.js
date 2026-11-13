/**
 * Who may use models outside GWDG (TERMI_EXTERNAL_PUBKEYS): npub/hex entries
 * and kind 30000 profile lists (naddr). Security gate — every error path
 * means "not listed".
 */
import { env } from '$env/dynamic/private';
import { verifyEvent } from 'nostr-tools/pure';
import { decodeIdentifier, fetchFirstEvent, getRelaysForKind } from '../relay-fetch.js';
import { normalizePubkey } from '../blossom-eligibility.js';
import { parseArray } from '../env-parse.js';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * @typedef {{ kind: 30000, pubkey: string, identifier: string, relays: string[] }} ListPointer
 */

/** @param {ListPointer} p */
function defaultFetchList(p) {
  return fetchFirstEvent(
    { kinds: [30000], authors: [p.pubkey], '#d': [p.identifier], limit: 1 },
    getRelaysForKind(30000, p.relays)
  );
}

/**
 * @param {{ entries: string[], fetchList?: (p: ListPointer) => Promise<any>, now?: () => number, ttlMs?: number }} opts
 */
export function createExternalAccess({
  entries,
  fetchList = defaultFetchList,
  now = Date.now,
  ttlMs = 10 * 60_000
}) {
  const fixed = new Set();
  /** @type {{ pointer: ListPointer, members: Set<string>, createdAt: number, loadedAt: number, loading: Promise<void> | null, loaded: boolean }[]} */
  const lists = [];
  for (const entry of entries) {
    const hex = normalizePubkey(entry);
    if (hex) fixed.add(hex);
    else if (entry.startsWith('naddr1')) {
      const d = decodeIdentifier(entry);
      if (d?.type === 'naddr' && d.kind === 30000) {
        lists.push({
          pointer: { kind: 30000, pubkey: d.pubkey, identifier: d.identifier, relays: d.relays },
          members: new Set(),
          createdAt: -1,
          loadedAt: 0,
          loading: null,
          loaded: false
        });
      }
    }
  }

  /** @param {(typeof lists)[number]} l */
  function load(l) {
    if (!l.loading) {
      l.loading = (async () => {
        try {
          const ev = await fetchList(l.pointer);
          const dTag = ev?.tags?.find((t) => t?.[0] === 'd')?.[1];
          // An older copy never replaces a newer one we already hold.
          if (
            ev?.kind === 30000 &&
            ev.pubkey === l.pointer.pubkey &&
            dTag === l.pointer.identifier &&
            ev.created_at >= l.createdAt &&
            verifyEvent(ev)
          ) {
            l.members = new Set(
              ev.tags
                .filter((t) => t[0] === 'p' && HEX64.test(t[1]))
                .map((/** @type {string[]} */ t) => t[1])
            );
            l.createdAt = ev.created_at;
            l.loaded = true;
          }
        } catch {
          /* keep the last good copy */
        } finally {
          // a failed refresh waits a TTL too: a dead relay is not asked on every call
          l.loadedAt = now();
          l.loading = null;
        }
      })();
    }
    return l.loading;
  }

  return {
    /** @param {string} pubkey */
    async isListed(pubkey) {
      const hex = normalizePubkey(pubkey);
      if (!hex) return false;
      if (fixed.has(hex)) return true;
      for (const l of lists) {
        if (!l.loaded) await load(l);
        else if (now() - l.loadedAt >= ttlMs) void load(l);
        if (l.members.has(hex)) return true;
      }
      return false;
    }
  };
}

/** @type {ReturnType<typeof createExternalAccess> | undefined} */
let _access;

export function getExternalAccess() {
  return (_access ??= createExternalAccess({ entries: parseArray(env.TERMI_EXTERNAL_PUBKEYS) }));
}

/** Test seam. */
export function _resetExternalAccessForTests() {
  _access = undefined;
}
