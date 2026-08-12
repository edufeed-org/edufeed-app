// Roster fan-out machinery — Task 1. Ported verbatim from
// AreaMembersModal.svelte's local tryOnce/fanOut/putUserOn/removeUserOn, the
// one deliberate change being that putUserOn/removeUserOn take an explicit
// `user = {pubkey, signer}` param instead of reading the active user
// internally — callers (the modal) already have it in hand. reportFanOut
// (toast/UI) stays in the modal; aggregateFanOut stays in area-members.js.
import {
  buildPutUserTemplate,
  buildRemoveUserTemplate,
  publishToGroupRelay
} from './group-management.js';
import { pool } from '$lib/stores/nostr-infrastructure.svelte';
import { aggregateFanOut } from './area-members.js';

/**
 * @param {{id: string, relay: string}} pointer
 * @param {string} pubkey
 * @param {string[]} roles
 * @param {{pubkey: string, signer: any}} user
 */
export function putUserOn(pointer, pubkey, roles = [], user) {
  return publishToGroupRelay(
    pool.relay(pointer.relay),
    buildPutUserTemplate(pointer.id, pubkey, roles),
    user
  );
}

/**
 * @param {{id: string, relay: string}} pointer
 * @param {string} pubkey
 * @param {{pubkey: string, signer: any}} user
 */
export function removeUserOn(pointer, pubkey, user) {
  return publishToGroupRelay(
    pool.relay(pointer.relay),
    buildRemoveUserTemplate(pointer.id, pubkey),
    user
  );
}

/**
 * Try `action(item)` once, then once more on failure. Never throws — a
 * NIP-29 relay refusing one channel (not admin there, offline, etc.) must
 * not blind the rest of the fan-out or leave an unhandled rejection behind.
 * @template T
 * @param {T} item
 * @param {string} label for the console diagnostics
 * @param {(item: T) => Promise<any>} action
 */
export async function tryOnce(item, label, action) {
  try {
    await action(item);
    return true;
  } catch (err) {
    console.warn('groups: area fan-out action failed, retrying once', label, err);
    try {
      await action(item);
      return true;
    } catch (err2) {
      console.error('groups: area fan-out retry failed', label, err2);
      return false;
    }
  }
}

/**
 * Generic sequential fan-out: one item at a time (never parallel — a burst
 * of publishes at one relay is exactly what tryOnce's retry is meant to
 * absorb gracefully, not race). `keyOf` doubles as both the retry log label
 * and the aggregateFanOut result key, so every caller — single pointer
 * (repair/remove/add) or {pointer, pubkey} pair (bulk sync) — shares this
 * one loop.
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} keyOf
 * @param {(item: T) => Promise<any>} action
 */
export async function fanOut(items, keyOf, action) {
  const results = [];
  for (const item of items) {
    const key = keyOf(item);
    const ok = await tryOnce(item, key, action);
    results.push({ key, ok });
  }
  return aggregateFanOut(results);
}
