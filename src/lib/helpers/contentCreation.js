import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { modalStore } from '$lib/stores/modal.svelte.js';

/**
 * @typedef {{ type: 'route', path: string } | { type: 'modal', modal: import('$lib/stores/modal.svelte.js').ModalType, props?: Record<string, any> }} CreationTarget
 */

/** @type {Record<string, CreationTarget>} */
export const CONTENT_CREATION = {
  calendar: {
    type: 'modal',
    modal: 'calendarEvent',
    props: { selectedDate: new Date(), mode: 'create' }
  },
  learning: { type: 'route', path: '/create/resource' },
  article: { type: 'route', path: '/create/article' },
  wiki: { type: 'route', path: '/create/wiki' },
  form: { type: 'route', path: '/forms/new' }
};

/**
 * Navigate to the creation page/modal for a content type.
 * @param {string} key - Content type key from CONTENT_CREATION
 * @param {{ communityPubkey?: string }} [opts]
 */
export function navigateToCreate(key, { communityPubkey = '' } = {}) {
  const target = CONTENT_CREATION[key];
  if (!target) return;

  if (target.type === 'route') {
    const query = communityPubkey ? `?community=${communityPubkey}` : '';
    goto(resolve(/** @type {any} */ (`${target.path}${query}`)));
  } else {
    modalStore.openModal(target.modal, { communityPubkey, ...target.props });
  }
}
