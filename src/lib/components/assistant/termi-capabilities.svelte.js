// Which capability cards this account gets (empty chat, "what's new" dialog) and their copy.
import * as m from '$lib/paraglide/messages';
import { runtimeConfig } from '$lib/stores/config.svelte.js';
import { canSign } from '$lib/helpers/signing-guard.js';
import { capabilityCards } from '$lib/termi/capabilities.js';
import { isTermiEligible } from './termi-router.js';

/**
 * Call during component initialisation.
 * @param {() => any} getUser
 * @returns {{ readonly cards: import('$lib/termi/capabilities.js').CapabilityCard[], readonly settled: boolean }}
 *   `settled` is false while the eligibility probe runs.
 */
export function useTermiCapabilities(getUser) {
  let eligible = $state(/** @type {boolean | undefined} */ (undefined));
  // a readonly account can use neither: it gets the search card only, no promise and no lock
  const probes = () => !!runtimeConfig.termi?.llm && !!getUser() && canSign(getUser());

  $effect(() => {
    const user = getUser();
    eligible = undefined;
    if (!probes()) return;
    let live = true;
    isTermiEligible(user.pubkey, (...a) => fetch(...a)).then((v) => {
      if (live) eligible = v;
    });
    return () => {
      live = false;
    };
  });

  return {
    get cards() {
      return capabilityCards({
        ai: !!runtimeConfig.termi?.enabled,
        llm: !!runtimeConfig.termi?.llm,
        loggedIn: !!getUser(),
        eligible
      });
    },
    get settled() {
      return !probes() || eligible !== undefined;
    }
  };
}

/**
 * @param {import('$lib/termi/capabilities.js').CapabilityCard} card
 * @returns {{ title: string, text: string, action?: string }}
 */
export function capabilityCopy(card) {
  switch (card.id) {
    case 'material':
      return { title: m.termi_cap_material_title(), text: m.termi_cap_material_text() };
    case 'lesson':
      return { title: m.termi_cap_lesson_title(), text: m.termi_cap_lesson_text() };
    case 'import':
      return { title: m.termi_cap_import_title(), text: m.termi_cap_import_text() };
    default:
      return card.locked === 'login'
        ? {
            title: m.termi_cap_more_title(),
            text: m.termi_cap_more_login_text(),
            action: m.common_login()
          }
        : {
            title: m.termi_cap_more_title(),
            text: m.termi_cap_more_address_text(),
            // only where this deployment hands out addresses
            action:
              runtimeConfig.membership?.enabled && runtimeConfig.membership?.handleDomain
                ? m.termi_hint_nip05_cta()
                : undefined
          };
  }
}
