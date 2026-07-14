/**
 * App-wide event factory (applesauce v6 compat wrapper).
 *
 * v6 removed the legacy EventFactory class and blueprints. This wrapper
 * preserves the legacy call shape used across the app —
 * `createAppEventFactory({ signer }).build/.modify/.modifyTags/.delete/.sign`
 * — implemented on v6's context-free event operations, and applies the
 * NIP-89 client tag when the user has opted in.
 *
 * Blueprint-based creation (`factory.create(Blueprint, …)`) is gone: those
 * call sites use the v6 typed factories (NoteFactory, CommentFactory, …)
 * and `finalizeDraft()` below for the client tag.
 */

import { DeleteFactory } from 'applesauce-core/factories';
import {
  stripSignature,
  stripStamp,
  stripSymbols,
  updateCreatedAt,
  includeReplaceableIdentifier
} from 'applesauce-core/operations/event';
import { modifyTags } from 'applesauce-core/operations/tags';
import { setClient } from 'applesauce-core/operations';
import { EncryptedContentSymbol } from 'applesauce-core/helpers/encrypted-content';
import { unixNow } from 'applesauce-core/helpers/time';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { appSettings } from '$lib/stores/app-settings.svelte.js';

/**
 * @typedef {import('applesauce-core/factories').EventSigner} EventSigner
 * @typedef {(draft: any) => any | Promise<any>} EventOperation
 */

/** Whether the NIP-89 client tag should be appended (read at call time). */
function clientTagEnabled() {
  return !!(appSettings.includeClientTag && runtimeConfig.clientName);
}

/**
 * Run a draft through a pipeline of v6 context-free operations.
 * @param {any} draft
 * @param {Array<EventOperation | undefined | null>} operations
 */
async function pipeOperations(draft, operations) {
  let result = draft;
  for (const op of operations) {
    if (op) result = await op(result);
  }
  return result;
}

/**
 * Append the app client tag to a finished draft when enabled. Use this for
 * drafts produced by v6 typed factories (NoteFactory etc.) before signing.
 * @param {any} draftOrFactory - an event template or a v6 factory chain (thenable)
 */
export async function finalizeDraft(draftOrFactory) {
  const draft = await draftOrFactory;
  if (clientTagEnabled()) {
    return await setClient(runtimeConfig.clientName)(draft);
  }
  return draft;
}

/**
 * Create the app event factory (legacy-shaped, v6-backed).
 * Mirrors v5 semantics: build/modify strip stale symbols and signatures,
 * ensure addressable events have a d tag, and append the client tag.
 *
 * @param {{ signer?: EventSigner }} [options]
 */
export function createAppEventFactory(options = {}) {
  const signer = options.signer;

  return {
    /**
     * Build an event template with operations.
     * @param {any} template - partial template, must include kind
     * @param {...(EventOperation | undefined | null)} operations
     */
    async build(template, ...operations) {
      const draft = { created_at: unixNow(), tags: [], content: '', ...template };
      return await pipeOperations(draft, [
        stripSymbols([EncryptedContentSymbol]),
        includeReplaceableIdentifier(),
        stripSignature(),
        stripStamp(),
        ...operations,
        clientTagEnabled() ? setClient(runtimeConfig.clientName) : null
      ]);
    },

    /**
     * Modify an existing event with operations; refreshes created_at.
     * @param {any} event
     * @param {...(EventOperation | undefined | null)} operations
     */
    async modify(event, ...operations) {
      // Unwrap cast objects from applesauce-common (e.g. Profile casts)
      const source =
        event && 'event' in event && event.event?.kind !== undefined ? event.event : event;
      return await pipeOperations(source, [
        stripSymbols([EncryptedContentSymbol]),
        includeReplaceableIdentifier(),
        stripSignature(),
        stripStamp(),
        updateCreatedAt(),
        ...operations,
        clientTagEnabled() ? setClient(runtimeConfig.clientName) : null
      ]);
    },

    /**
     * Modify a list event's public/hidden tags; refreshes created_at.
     * @param {any} event
     * @param {any} tagOperations
     * @param {EventOperation | EventOperation[]} [eventOperations]
     */
    async modifyTags(event, tagOperations, eventOperations) {
      /** @type {EventOperation[]} */
      let eventOperationsArr = [];
      if (typeof eventOperations === 'function') eventOperationsArr = [eventOperations];
      else if (Array.isArray(eventOperations))
        eventOperationsArr = eventOperations.filter((e) => !!e);
      // v6 modifyTags takes the signer explicitly (needed for hidden tags)
      return await this.modify(event, modifyTags(tagOperations, signer), ...eventOperationsArr);
    },

    /**
     * Build a NIP-09 deletion event for the given events.
     * @param {any[]} events
     * @param {string} [reason]
     */
    async delete(events, reason) {
      const draft = await DeleteFactory.fromEvents(events, reason);
      return await pipeOperations(draft, [
        clientTagEnabled() ? setClient(runtimeConfig.clientName) : null
      ]);
    },

    /**
     * Sign a draft with the configured signer.
     * @param {any} draft
     * @returns {Promise<import('nostr-tools').NostrEvent>}
     */
    async sign(draft) {
      if (!signer) throw new Error('Missing signer');
      return await signer.signEvent(draft);
    }
  };
}
