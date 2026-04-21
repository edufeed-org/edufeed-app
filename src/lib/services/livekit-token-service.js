/**
 * LiveKit Token Service
 * Requests LiveKit room tokens via the server-side proxy to avoid CORS issues.
 */
import { createNIP98AuthHeader } from '$lib/helpers/nip98.js';

/**
 * Request a LiveKit token from the operator via server-side proxy.
 * @param {string} operatorUrl - Base URL of the LiveKit Nostr operator
 * @param {string} roomCoordinate - Room coordinate "30312:<pubkey>:<d-tag>"
 * @param {string} communityPubkey - Community pubkey for authorization
 * @param {(draft: any) => Promise<any>} signer - Event signing function
 * @returns {Promise<{token: string, url: string}>}
 */
export async function requestLiveKitToken(operatorUrl, roomCoordinate, communityPubkey, signer) {
  // NIP-98 signs against the operator's actual URL (not the proxy) so the operator can verify
  const operatorEndpoint = `${operatorUrl.replace(/\/$/, '')}/token`;
  const operatorBody = JSON.stringify({ room: roomCoordinate, community: communityPubkey });

  const authHeader = await createNIP98AuthHeader(operatorEndpoint, 'POST', operatorBody, signer);

  const response = await fetch('/api/meet/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader
    },
    body: JSON.stringify({ operatorUrl, room: roomCoordinate, community: communityPubkey })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token request failed (${response.status}): ${text}`);
  }

  return response.json();
}
