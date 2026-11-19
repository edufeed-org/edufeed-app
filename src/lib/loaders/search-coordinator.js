/**
 * Search coordinator client: asks nope-mcp, over ContextVM (MCP over Nostr),
 * for the cross-relay order of a learning-resource search.
 *
 * The app keeps doing its own NIP-50 search against the user's relays and
 * shows those results at once. The coordinator interprets the question
 * (level, grade, resource type) and merges across relays; its answer is used
 * only to re-order the events the app already holds (searchRank.js,
 * applyCoordinatorOrder), so the app never has to trust it for content.
 *
 * Privacy: a random key per page load, so a search is not tied to the user's
 * npub; encrypted to the coordinator as ephemeral gift wraps, so the transport
 * relay and anyone subscribed to it see neither the search text nor a stored
 * copy. Only the search text and the relays to search are sent.
 *
 * Browser-only (dynamic import of the ContextVM SDK on first use).
 */
import { nip19 } from 'nostr-tools';

/**
 * `kind:pubkey:d` for each result's naddr, in order. Entries without a
 * decodable naddr are skipped.
 *
 * @param {unknown} results - `results` of nope-mcp's search_content
 * @returns {string[]}
 */
export function addressesFromResults(results) {
  if (!Array.isArray(results)) return [];
  const out = [];
  for (const r of results) {
    try {
      const decoded = nip19.decode(r?.naddr);
      if (decoded.type !== 'naddr') continue;
      out.push(`${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`);
    } catch {
      // not an naddr: skip
    }
  }
  return out;
}

/**
 * The SDK's relay pool retries a publish forever unless given an abort signal,
 * and its client transport passes none. With the transport relay down every
 * search would leave a retry loop behind, and stale searches would go out when
 * the relay returns. This gives each publish a deadline.
 *
 * @template {new (...args: any[]) => {publish: (event: any, opts?: any) => Promise<any>}} T
 * @param {T} Pool
 * @param {number} ms
 * @returns {T}
 */
export function withPublishDeadline(Pool, ms) {
  return class extends Pool {
    /** @param {any} event @param {any} [opts] */
    publish(event, opts) {
      return super.publish(event, { ...opts, abortSignal: AbortSignal.timeout(ms) });
    }
  };
}

/** @type {Map<string, Promise<import('@contextvm/mcp-sdk/client').Client>>} one connection per coordinator and page load */
const clients = new Map();

/** @param {{pubkey: string, relays: string[]}} coordinator */
function connect(coordinator) {
  const key = `${coordinator.pubkey}|${coordinator.relays.join(',')}`;
  let client = clients.get(key);
  if (!client) {
    client = (async () => {
      const [{ Client }, sdk] = await Promise.all([
        import('@contextvm/mcp-sdk/client'),
        import('@contextvm/sdk')
      ]);
      const Pool = withPublishDeadline(sdk.ApplesauceRelayPool, 10_000);
      const c = new Client({ name: 'edufeed-search', version: '1.0.0' });
      await c.connect(
        new sdk.NostrClientTransport({
          serverPubkey: coordinator.pubkey,
          relayHandler: new Pool(coordinator.relays),
          signer: new sdk.PrivateKeySigner(), // random key: searches are not tied to the user
          // Encrypted, as ephemeral gift wraps: unencrypted requests would let
          // anyone subscribed to the transport relay read every search text.
          encryptionMode: sdk.EncryptionMode.REQUIRED,
          giftWrapMode: sdk.GiftWrapMode.EPHEMERAL,
          isStateless: true,
          logLevel: 'silent'
        })
      );
      return c;
    })();
    client.catch(() => clients.delete(key)); // a failed connect is retried on the next search
    clients.set(key, client);
  }
  return client;
}

/**
 * Arguments of nope-mcp's search_content. `relays` are the relays the app
 * itself searches: without them the coordinator searches only its default
 * relay, and that one relay's hits would be put before all others.
 *
 * @param {string} text
 * @param {string[] | undefined} relays
 * @param {number} limit
 */
export function searchArguments(text, relays, limit) {
  // compact: addresses only. A full 50-result answer is larger than the
  // transport relays' message limit once it is gift-wrapped.
  return {
    query: text,
    types: ['resource'],
    limit,
    compact: true,
    ...(relays?.length ? { relays } : {})
  };
}

/**
 * The coordinator's order for a search text, as addresses, best first.
 * Resolves to null on timeout, on any error and on an answer it cannot read
 * (including the coordinator's error payload, e.g. for a relay it does not
 * know): the caller then simply keeps its own order.
 *
 * @param {{pubkey?: string | null, relays?: string[]}} coordinator - `relays` here are the ContextVM transport relays
 * @param {string} text
 * @param {{relays?: string[], limit?: number, timeoutMs?: number}} [options] - `relays`: the relays to search
 * @returns {Promise<string[] | null>}
 */
export async function coordinatorOrder(
  coordinator,
  text,
  { relays, limit = 50, timeoutMs = 4000 } = {}
) {
  if (!coordinator?.pubkey || !coordinator.relays?.length || !text.trim()) return null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const timeout = new Promise((resolve) => (timer = setTimeout(() => resolve(null), timeoutMs)));
  const answer = (async () => {
    try {
      const client = await connect(/** @type {{pubkey: string, relays: string[]}} */ (coordinator));
      const result = await client.callTool(
        { name: 'search_content', arguments: searchArguments(text, relays, limit) },
        undefined,
        { timeout: timeoutMs } // the request ends with the race, not a minute later
      );
      const body = JSON.parse(result.content?.find((c) => c.type === 'text')?.text ?? 'null');
      const order = addressesFromResults(body?.results);
      return order.length ? order : null;
    } catch (error) {
      console.debug('🔍 search coordinator:', error);
      return null;
    }
  })();
  return Promise.race([answer, timeout]).finally(() => clearTimeout(timer));
}
