<script>
  // Findability layer for a channel's webxdc sessions (Task 9): a collapsed
  // bar above the timeline listing every app someone has shared here, so a
  // session isn't lost once its launch card scrolls out of view. Renders
  // nothing when the channel has no webxdc shares.
  //
  // Presentational only: the per-session 9450 title enrichment used to live
  // here (gated on the bar being open), but launch cards need the same data
  // unconditionally, so GroupChat now owns the fetch and hands the result
  // down as `sessionMeta`.
  import * as m from '$lib/paraglide/messages';
  import { deriveSessions } from '$lib/webxdc/session-events.js';

  /** @type {{pointer: any, messages: any[], sessionMeta?: Map<string, string>, onOpen: (s: any) => void}} */
  let { pointer: _pointer, messages, sessionMeta = new Map(), onOpen } = $props();

  const sessions = $derived(deriveSessions(messages));
</script>

{#if sessions.length > 0}
  <details class="border-b border-base-300 bg-base-200/40 px-3 py-1 text-sm">
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
