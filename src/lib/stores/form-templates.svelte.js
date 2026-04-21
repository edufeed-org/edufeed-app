import { TimelineModel } from 'applesauce-core/models';
import { formTemplateLoader } from '$lib/loaders/community.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

/**
 * Reactive hook that loads form templates (kind 30168) for a set of author pubkeys.
 *
 * @param {() => string[]} getPubkeys - Reactive getter returning author pubkeys to load
 * @returns {() => any[]} - Reactive getter returning form template events
 */
export function useFormTemplates(getPubkeys) {
  /** @type {any[]} */
  let formTemplates = $state.raw([]);

  $effect(() => {
    const authors = getPubkeys();
    if (!authors.length) return;

    const loaderSub = formTemplateLoader(authors)().subscribe();
    const modelSub = eventStore
      .model(TimelineModel, { kinds: [30168], authors })
      .subscribe((events) => {
        formTemplates = events || [];
      });

    return () => {
      loaderSub?.unsubscribe();
      modelSub?.unsubscribe();
    };
  });

  return () => formTemplates;
}
