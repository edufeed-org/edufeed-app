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
 * Privacy: a random key per page load and unencrypted ephemeral messages, so
 * a search is not tied to the user's npub and nothing is stored on the
 * transport relay. Only the search text is sent.
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

/** @type {Map<string, Promise<import('@contextvm/mcp-sdk/client').Client>>} one connection per coordinator and page load */
const clients = new Map();

/** @param {{pubkey: string, relays: string[]}} coordinator */
function connect(coordinator) {
  const key = `${coordinator.pubkey}|${coordinator.relays.join(',')}`;
  let client = clients.get(key);
  if (!client) {
    client = (async () => {
      const [
        { Client },
        { ApplesauceRelayPool, EncryptionMode, NostrClientTransport, PrivateKeySigner }
      ] = await Promise.all([import('@contextvm/mcp-sdk/client'), import('@contextvm/sdk')]);
      const c = new Client({ name: 'edufeed-search', version: '1.0.0' });
      await c.connect(
        new NostrClientTransport({
          serverPubkey: coordinator.pubkey,
          relayHandler: new ApplesauceRelayPool(coordinator.relays),
          signer: new PrivateKeySigner(), // random key: searches are not tied to the user
          encryptionMode: EncryptionMode.DISABLED, // ephemeral kind 25910, nothing stored
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
 * The coordinator's order for a search text, as addresses, best first.
 * Resolves to null on timeout, on any error and on an answer it cannot read:
 * the caller then simply keeps its own order.
 *
 * @param {{pubkey?: string | null, relays?: string[]}} coordinator
 * @param {string} text
 * @param {{limit?: number, timeoutMs?: number}} [options]
 * @returns {Promise<string[] | null>}
 */
export async function coordinatorOrder(coordinator, text, { limit = 50, timeoutMs = 4000 } = {}) {
  if (!coordinator?.pubkey || !coordinator.relays?.length || !text.trim()) return null;
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const answer = (async () => {
    try {
      const client = await connect(/** @type {{pubkey: string, relays: string[]}} */ (coordinator));
      const result = await client.callTool({
        name: 'search_content',
        arguments: { query: text, types: ['resource'], limit }
      });
      const body = JSON.parse(result.content?.find((c) => c.type === 'text')?.text ?? 'null');
      const order = addressesFromResults(body?.results);
      return order.length ? order : null;
    } catch (error) {
      console.debug('🔍 search coordinator:', error);
      return null;
    }
  })();
  return Promise.race([answer, timeout]);
}
