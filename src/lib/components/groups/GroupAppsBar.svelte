<script>
  // Findability layer for a channel's webxdc sessions (Task 9): a collapsed
  // bar above the timeline listing every app someone has shared here, so a
  // session isn't lost once its launch card scrolls out of view. Renders
  // nothing when the channel has no webxdc shares.
  import * as m from '$lib/paraglide/messages';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { toArray } from 'rxjs/operators';
  import { deriveSessions, WEBXDC_STATE_KIND } from '$lib/webxdc/session-events.js';

  /** @type {{pointer: any, messages: any[], onOpen: (s: any) => void}} */
  let { pointer, messages, onOpen } = $props();

  const sessions = $derived(deriveSessions(messages));

  // `sessions` is a new array on every render of `messages` (i.e. any new
  // chat message), which would retrigger the effect below on every message
  // even when the set of sessions hasn't changed. Depend on this stable
  // string key instead — a $derived primitive only marks dependents dirty
  // when its VALUE changes, so unrelated messages no longer refetch; a
  // genuinely new/removed session still does.
  const sessionKey = $derived(sessions.map((s) => s.sessionId).join(','));

  // Funnel `pointer` into primitive $derived values too: the effect below
  // must depend ONLY on memoized-primitive deriveds (sessionKey/relayUrl/
  // groupId), never on a raw object-prop read like `pointer.relay` directly
  // — an unmemoized read short-circuits nothing and defeats the sessionKey
  // guard's whole point the moment it's mixed into the same effect.
  const relayUrl = $derived(pointer.relay);
  const groupId = $derived(pointer.id);

  // Collapsed by default. The enrichment REQs below are one per session, so
  // they only run once a reader actually opens the bar — most channel
  // sessions are never inspected this closely, and firing on every message
  // (the old behaviour, one bundled REQ) meant a REQ nobody asked for on
  // every unrelated chat message.
  let detailsOpen = $state(false);
  /** @param {Event} e */
  function handleToggle(e) {
    detailsOpen = /** @type {HTMLDetailsElement} */ (e.target)?.open ?? false;
  }

  // Latest 9450 per session for a live-ish subtitle (document/summary tags).
  // One request() per session (kept scoped with '#i', unlike the old bundled
  // '#h'-only REQ) — merged wholesale into sessionMeta as each answers.
  // Fetched once per (sessionKey, opened) pair: `fetchedKey` gates re-fetch
  // the same way the old sessionKey-only effect did, plus "opened" so
  // toggling the bar shut and open again doesn't refire it.
  let sessionMeta = $state.raw(new Map());
  let fetchedKey = '';
  $effect(() => {
    if (!detailsOpen || !sessionKey) return;
    const key = `${sessionKey}\x1f${relayUrl}\x1f${groupId}`;
    if (fetchedKey === key) return;
    fetchedKey = key;
    const subs = sessionKey.split(',').map((sid) =>
      pool
        .relay(relayUrl)
        .request(
          { kinds: [WEBXDC_STATE_KIND], '#h': [groupId], '#i': [sid], limit: 1 },
          { timeout: 2500 }
        )
        .pipe(toArray())
        .subscribe((events) => {
          const latest = [...events].sort((a, b) => b.created_at - a.created_at)[0];
          if (!latest) return;
          const tag = (/** @type {string} */ n) => latest.tags?.find((t) => t[0] === n)?.[1];
          const next = new Map(sessionMeta); // eslint-disable-line svelte/prefer-svelte-reactivity -- rebuilt wholesale, then swapped in
          next.set(sid, tag('document') || tag('summary') || '');
          sessionMeta = next;
        })
    );
    return () => subs.forEach((sub) => sub.unsubscribe());
  });
</script>

{#if sessions.length > 0}
  <details
    class="border-b border-base-300 bg-base-200/40 px-3 py-1 text-sm"
    ontoggle={handleToggle}
  >
    <summary class="cursor-pointer text-xs font-semibold opacity-70">
      {m.webxdc_apps_bar_title()} ({sessions.length})
    </summary>
    <ul class="flex flex-col gap-1 py-1">
      {#each sessions as session (session.sessionId)}
        <li>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded p-1 text-left hover:bg-base-300/50"
            onclick={() => onOpen(session)}
          >
            {#if session.app.iconUrl}
              <img src={session.app.iconUrl} alt="" class="size-5 rounded" />
            {:else}
              ▦
            {/if}
            <span class="truncate font-medium">{session.app.name || session.app.url}</span>
            {#if sessionMeta.get(session.sessionId)}
              <span class="truncate text-xs opacity-60">{sessionMeta.get(session.sessionId)}</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  </details>
{/if}
