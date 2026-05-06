<script>
  // Post-login nudge listing deployment-configured suggested users (npubs in
  // `runtimeConfig.signup.suggestedUsers`). User picks a subset; we publish a
  // kind-3 contact list. Dismiss flag persists per-pubkey so the nudge is
  // one-shot.
  //
  // Pattern mirrors the kind-3 publish from the original SignupModal — kept
  // inline here because there is currently only one consumer.
  import { nip19 } from 'nostr-tools';
  import { SvelteSet } from 'svelte/reactivity';
  import * as m from '$lib/paraglide/messages';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { publishEvent } from '$lib/services/publish-service.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';

  const getActiveUser = useActiveUser();

  let flagsTrigger = $state(0);
  let isPublishing = $state(false);

  /** @param {string} pubkey */
  function dismissFlag(pubkey) {
    return `follows-banner-dismissed:${pubkey}`;
  }

  /**
   * Decoded suggested users with their hex pubkeys, ready for kind-3 p-tags.
   * Skips entries that fail to decode rather than blowing up the banner.
   */
  const suggestions = $derived.by(() => {
    const npubs = runtimeConfig.signup?.suggestedUsers || [];
    return /** @type {{ npub: string, pubkey: string }[]} */ (
      npubs
        .map((npub) => {
          try {
            const decoded = nip19.decode(npub);
            if (decoded.type !== 'npub') return null;
            return { npub, pubkey: String(decoded.data) };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
    );
  });

  // All suggested pubkeys default to checked — opt-in is the friendlier
  // default for a one-shot nudge; users can untick anything they don't want.
  // Re-derives whenever suggestions change; user toggles mutate the SvelteSet
  // in place, which still triggers reactivity for has()/size reads.
  const selected = $derived(new SvelteSet(suggestions.map((s) => s.pubkey)));

  // Resolve display name + avatar for each suggested user. Falls back to
  // truncated npub if the profile event hasn't loaded yet.
  const getProfiles = useProfileMap(() => suggestions.map((s) => s.pubkey));

  const visible = $derived.by(() => {
    void flagsTrigger;
    const user = getActiveUser();
    if (!user) return false;
    if (suggestions.length === 0) return false;
    if (typeof localStorage === 'undefined') return false;
    // Only show to users who just signed up via the in-app wizard.
    // Existing/returning users shouldn't see a contact-list pitch on every load.
    if (!localStorage.getItem(`signed-up-here:${user.pubkey}`)) return false;
    if (localStorage.getItem(dismissFlag(user.pubkey))) return false;
    return true;
  });

  /** @param {string} pubkey */
  function isChecked(pubkey) {
    return selected.has(pubkey);
  }

  /** @param {string} pubkey */
  function toggle(pubkey) {
    if (selected.has(pubkey)) selected.delete(pubkey);
    else selected.add(pubkey);
  }

  function handleDismiss() {
    const user = getActiveUser();
    if (!user) return;
    localStorage.setItem(dismissFlag(user.pubkey), '1');
    flagsTrigger++;
  }

  async function handleFollow() {
    const user = getActiveUser();
    if (!user || !user.signer) return;
    const pubkeys = suggestions.map((s) => s.pubkey).filter((pk) => selected.has(pk));
    if (pubkeys.length === 0) return;

    try {
      isPublishing = true;
      const contactsEvent = {
        kind: 3,
        created_at: Math.floor(Date.now() / 1000),
        tags: pubkeys.map((pk) => ['p', pk]),
        content: '',
        pubkey: user.pubkey
      };
      const signed = await user.signer.signEvent(contactsEvent);

      // Optimistic apply + immediate dismiss → banner hides at once.
      // Mirrors the SignupModal.finishProfile() pattern; a "Follow selected"
      // click should not feel slower than the user's intention.
      eventStore.add(signed);
      localStorage.setItem(dismissFlag(user.pubkey), '1');
      flagsTrigger++;

      // Fire-and-forget; do not block UI on relay round-trips.
      publishEvent(signed, pubkeys).catch((err) =>
        console.warn('Background publish of suggested-follows kind 3 failed:', err)
      );
    } catch (err) {
      console.warn('Suggested-follows sign/apply failed:', err);
    } finally {
      isPublishing = false;
    }
  }
</script>

{#if visible}
  <div data-testid="suggested-follows-banner" class="alert alert-info shadow-sm">
    <div class="w-full">
      <h3 class="font-semibold">{m.auth_follows_banner_title()}</h3>
      <p class="mb-2 text-sm opacity-80">{m.auth_follows_banner_body()}</p>

      <ul class="space-y-2">
        {#each suggestions as s (s.pubkey)}
          {@const profile = getProfiles().get(s.pubkey)}
          {@const name = profile?.display_name || profile?.name}
          <li data-testid="suggested-follow-row" class="flex items-center gap-3">
            <input
              data-testid="suggested-follow-checkbox"
              type="checkbox"
              class="checkbox checkbox-sm"
              checked={isChecked(s.pubkey)}
              onchange={() => toggle(s.pubkey)}
            />
            <div class="avatar">
              <div class="h-8 w-8 rounded-full bg-base-300">
                {#if profile?.picture}
                  <img src={profile.picture} alt="" loading="lazy" />
                {/if}
              </div>
            </div>
            <div class="min-w-0 flex-1">
              {#if name}
                <div class="truncate text-sm font-medium">{name}</div>
                {#if profile?.about}
                  <div class="truncate text-xs opacity-70">{profile.about}</div>
                {/if}
              {:else}
                <code class="text-xs opacity-70">{s.npub.slice(0, 16)}…</code>
              {/if}
            </div>
          </li>
        {/each}
      </ul>

      <div class="mt-3 flex justify-end gap-2">
        <button
          data-testid="follows-banner-dismiss"
          class="btn btn-ghost btn-sm"
          onclick={handleDismiss}
          disabled={isPublishing}
        >
          {m.auth_follows_banner_dismiss()}
        </button>
        <button
          data-testid="follows-banner-follow"
          class="btn btn-sm btn-primary"
          onclick={handleFollow}
          disabled={isPublishing || selected.size === 0}
        >
          {#if isPublishing}
            <span class="loading loading-sm loading-spinner"></span>
          {/if}
          {m.auth_follows_banner_follow_cta()}
        </button>
      </div>
    </div>
  </div>
{/if}
