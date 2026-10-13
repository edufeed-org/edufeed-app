/**
 * Blossom Settings Service - Save NIP-B7 Blossom server preferences (kind 10063)
 */

import { publishEvent } from './publish-service.js';
import { manager } from '$lib/stores/accounts.svelte.js';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { normalizeServerUrl } from '$lib/helpers/blossom-trust.js';
import { isBlossomEligible } from '$lib/stores/blossom-eligibility.svelte.js';

/**
 * Get default Blossom servers from runtime config
 * @returns {string[]}
 */
export function getDefaultBlossomServers() {
  return (
    runtimeConfig.defaultBlossomServers || [
      'https://blossom.primal.net',
      'https://cdn.satellite.earth'
    ]
  );
}

/**
 * Public Blossom servers — where accounts the closed deployment server
 * refuses (see blossom-eligibility) upload instead.
 * @returns {string[]}
 */
export function getPublicBlossomServers() {
  const configured = runtimeConfig.blossom?.publicServers;
  return configured?.length ? configured : ['https://blossom.primal.net'];
}

/**
 * @param {string | null | undefined} url
 * @param {string[]} list
 */
function inList(url, list) {
  if (!url) return false;
  const key = normalizeServerUrl(url);
  return list.some((s) => normalizeServerUrl(s) === key);
}

/**
 * Is `url` one of the deployment's own servers (DEFAULT_BLOSSOM_SERVERS)?
 * Compared host/path-wise, so a trailing slash never matters.
 * @param {string | null | undefined} url
 */
export function isDefaultBlossomServer(url) {
  return inList(url, getDefaultBlossomServers());
}

/**
 * Is `url` one of the configured public servers?
 * @param {string | null | undefined} url
 */
export function isPublicBlossomServer(url) {
  return inList(url, getPublicBlossomServers());
}

/**
 * Save Blossom server list by publishing a kind 10063 event
 * @param {Array<{url: string}>} servers - Server configuration
 * @param {string} userPubkey - User's public key
 * @returns {Promise<Object>} The signed and published event
 */
export async function saveBlossomServers(servers, userPubkey) {
  if (!manager.active?.signer) {
    throw new Error('No signer available. Please login first.');
  }

  if (!servers || servers.length === 0) {
    throw new Error('At least one Blossom server is required');
  }

  // Build server tags
  const tags = servers.map((server) => ['server', server.url]);

  // Create the event (kind 10063 - replaceable)
  const event = {
    kind: 10063,
    pubkey: userPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: ''
  };

  try {
    // Sign the event with applesauce-accounts signer
    const signedEvent = await manager.active.signer.signEvent(event);

    // Publish using the outbox model
    const result = await publishEvent(signedEvent);

    if (!result.success) {
      throw new Error('Failed to publish to any relay');
    }

    return signedEvent;
  } catch (error) {
    console.error('Failed to save Blossom server list:', error);
    throw new Error(
      'Failed to save Blossom server list: ' +
        (error instanceof Error ? error.message : String(error))
    );
  }
}

/**
 * Validate a Blossom server URL
 * @param {string} url - Server URL to validate
 * @returns {{valid: boolean, error?: string}}
 */
export function validateBlossomUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  const trimmed = url.trim();

  if (!trimmed.startsWith('https://')) {
    return { valid: false, error: 'URL must start with https://' };
  }

  try {
    new URL(trimmed);
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

/**
 * Parse a Blossom server list event (kind 10063) into a structured format
 * @param {import('nostr-tools').NostrEvent | null | undefined} event - The kind 10063 event
 * @returns {Array<{url: string}>}
 */
export function parseBlossomServerEvent(event) {
  if (!event || !event.tags) return [];

  return event.tags
    .filter((/** @type {string[]} */ tag) => tag[0] === 'server')
    .map((/** @type {string[]} */ tag) => ({
      url: tag[1]
    }));
}

/**
 * Ordered upload targets for an account, deduped by host:
 *   1. the user's own kind 10063 list (their explicit choice, always first),
 *   2. the deployment's servers — only when the account is eligible for them
 *      (under a gate an unanswered check counts as "not eligible"),
 *   3. the public servers, so a refused upload always has somewhere to go.
 * Without a gate every account is eligible and the order is today's: user
 * list, then the deployment defaults.
 * @param {string} userPubkey
 * @param {import('applesauce-core').EventStore} eventStore
 * @param {{ eligible?: boolean }} [opts] override the eligibility prediction (tests)
 * @returns {string[]}
 */
export function getBlossomUploadServers(userPubkey, eventStore, opts = {}) {
  const eligible = opts.eligible ?? isBlossomEligible(userPubkey);
  /** @type {string[]} */
  const userServers =
    userPubkey && eventStore
      ? parseBlossomServerEvent(eventStore.getReplaceable(10063, userPubkey)).map((s) => s.url)
      : [];
  const ordered = [
    ...userServers,
    ...(eligible ? getDefaultBlossomServers() : []),
    ...getPublicBlossomServers()
  ];
  const seen = new Set();
  return ordered.filter((url) => {
    if (!url) return false;
    const key = normalizeServerUrl(url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Get the active blossom server URL for uploading — the first entry of
 * getBlossomUploadServers (user's kind 10063 first, else the deployment's
 * server when eligible, else a public one).
 * @param {string} userPubkey - User's public key
 * @param {import('applesauce-core').EventStore} eventStore - The event store to check
 * @param {{ eligible?: boolean }} [opts]
 * @returns {string} The blossom server URL to use for uploads
 */
export function getActiveBlossomServer(userPubkey, eventStore, opts = {}) {
  return getBlossomUploadServers(userPubkey, eventStore, opts)[0] || 'https://blossom.primal.net';
}
