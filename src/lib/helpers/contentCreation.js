import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { modalStore } from '$lib/stores/modal.svelte.js';
import { getEnabledVariants, getDefaultVariantId } from '$lib/config/resource-form-variants.js';

/**
 * @typedef {{ type: 'route', path: string } | { type: 'modal', modal: import('$lib/stores/modal.svelte.js').ModalType, props?: Record<string, any> } | { type: 'resource' }} CreationTarget
 */

/** @type {Record<string, CreationTarget>} */
export const CONTENT_CREATION = {
  calendar: {
    type: 'modal',
    modal: 'calendarEvent',
    props: { selectedDate: new Date(), mode: 'create' }
  },
  learning: { type: 'resource' },
  article: { type: 'route', path: '/create/article' },
  wiki: { type: 'route', path: '/create/wiki' },
  form: { type: 'route', path: '/forms/new' },
  poll: { type: 'modal', modal: 'createPoll' },
  bookmark: { type: 'modal', modal: 'addBookmark' }
};

/**
 * Build the create route for a metadata-form variant, preserving community context.
 * @param {string} variantId
 * @param {string} [communityPubkey]
 * @returns {string}
 */
export function resourceCreatePath(variantId, communityPubkey = '') {
  const query = communityPubkey ? `?community=${communityPubkey}` : '';
  return `/create/resource/${variantId}${query}`;
}

/**
 * Single entry point for "share learning resource": multi-variant deployments
 * get the step-0 variant picker modal, single-variant deployments navigate
 * straight to the default variant's form.
 * @param {{ communityPubkey?: string }} [opts]
 */
export function startResourceCreation({ communityPubkey = '' } = {}) {
  if (getEnabledVariants().length > 1) {
    modalStore.openModal('resourceVariantPicker', { communityPubkey });
    return;
  }
  goto(resolve(/** @type {any} */ (resourceCreatePath(getDefaultVariantId(), communityPubkey))));
}

/**
 * Navigate to the creation page/modal for a content type.
 * @param {string} key - Content type key from CONTENT_CREATION
 * @param {{ communityPubkey?: string }} [opts]
 */
export function navigateToCreate(key, { communityPubkey = '' } = {}) {
  const target = CONTENT_CREATION[key];
  if (!target) return;

  if (target.type === 'resource') {
    startResourceCreation({ communityPubkey });
  } else if (target.type === 'route') {
    const query = communityPubkey ? `?community=${communityPubkey}` : '';
    goto(resolve(/** @type {any} */ (`${target.path}${query}`)));
  } else {
    modalStore.openModal(target.modal, { communityPubkey, ...target.props });
  }
}
