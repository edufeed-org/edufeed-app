/**
 * Multi-device sync network I/O (browser-only): tip fetch over plain relay
 * WebSockets and Blossom blob download with failover. Kept free of app relay
 * infrastructure — the tip relays are the linked identity's, not the app's.
 */
import { TIP_OUTER_KIND } from './multidevice-sync.js';

/**
 * Fetch the newest tip event for (ephemeralPubkey, dTag) across the relays.
 *
 * @param {{relays: string[], ephemeralPubkey: string, dTag: string}} params
 * @param {number} [timeoutMs]
 * @returns {Promise<import('nostr-tools').Event | undefined>}
 */
export function fetchLatestTip({ relays, ephemeralPubkey, dTag }, timeoutMs = 6000) {
  return new Promise((resolve) => {
    /** @type {import('nostr-tools').Event | undefined} */
    let newest;
    let pending = relays.length;
    if (pending === 0) return resolve(undefined);
    const done = () => {
      if (--pending === 0) resolve(newest);
    };
    for (const url of relays) {
      let socket;
      try {
        socket = new WebSocket(url);
      } catch {
        done();
        continue;
      }
      const timer = setTimeout(() => {
        try {
          socket.close();
        } catch {
          /* already closed */
        }
        done();
      }, timeoutMs);
      const finish = () => {
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          /* already closed */
        }
        done();
      };
      socket.onopen = () =>
        socket.send(
          JSON.stringify([
            'REQ',
            'cordn-tip',
            { kinds: [TIP_OUTER_KIND], authors: [ephemeralPubkey], '#d': [dTag], limit: 3 }
          ])
        );
      socket.onmessage = (message) => {
        try {
          const data = JSON.parse(message.data);
          if (data[0] === 'EVENT' && (!newest || data[2].created_at > newest.created_at)) {
            newest = data[2];
          }
          if (data[0] === 'EOSE') finish();
        } catch {
          /* ignore malformed relay frames */
        }
      };
      socket.onerror = finish;
    }
  });
}

/**
 * Download a sealed document blob by address, trying servers in order.
 *
 * @param {string[]} servers
 * @param {string} address - sha256 hex
 * @returns {Promise<string>} sealed text
 */
export async function fetchBlossomText(servers, address) {
  /** @type {string | undefined} */
  let lastError;
  for (const server of servers) {
    try {
      const response = await fetch(`${server.replace(/\/$/, '')}/${address}`);
      if (response.ok) return await response.text();
      lastError = `${server}: HTTP ${response.status}`;
    } catch (error) {
      lastError = `${server}: ${error instanceof Error ? error.message : error}`;
    }
  }
  throw new Error(`Dokument ${address.slice(0, 8)}… nicht ladbar (${lastError})`);
}
