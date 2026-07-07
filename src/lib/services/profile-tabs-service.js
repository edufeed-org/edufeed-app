/**
 * Profile Tabs Service
 *
 * Persists the owner's profile-tab arrangement (order + hidden tabs) as a
 * kind 30078 (NIP-78) app-data event with d="edufeed:profile-tabs".
 * The tag list is a wholesale replacement computed from UI state, so the
 * event is rebuilt rather than modified tag-by-tag.
 */
import { createAppEventFactory } from '$lib/helpers/event-factory.js';
import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
import { manager } from '$lib/stores/accounts.svelte';
import { publishEvent } from '$lib/services/publish-service.js';
import { buildProfileTabsTags } from '$lib/helpers/profile-tabs.js';

/**
 * Save the active user's profile-tab configuration.
 * @param {string[]} order - all tab ids in display order
 * @param {string[]} hidden - ids hidden from visitors
 */
export async function saveProfileTabs(order, hidden) {
  const signer = manager.active?.signer;
  if (!signer) throw new Error('No active signer');

  const factory = createAppEventFactory({ signer });
  const template = await factory.build({
    kind: 30078,
    tags: buildProfileTabsTags(order, hidden)
  });
  const signed = await factory.sign(template);
  await publishEvent(signed, []);
  eventStore.add(signed);
}
