import { error } from '@sveltejs/kit';
import { loadPrivacyPolicy } from '$lib/server/privacy-policy.js';

// Plain server-rendered legal text: no Nostr, no client fetch. The route
// exists only on deployments that set PRIVACY_POLICY_PATH (see
// src/lib/server/privacy-policy.js); elsewhere it is a 404 and the
// "Datenschutz" links are hidden through runtimeConfig.privacy.enabled.
/** @type {import('./$types').PageServerLoad} */
export async function load() {
  const policy = await loadPrivacyPolicy();
  if (!policy) error(404, 'No privacy policy configured');
  return { html: policy.html };
}
