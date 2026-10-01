<script>
  /**
   * "Agent" chip next to an agent's name, with an online dot when its
   * companion has announced presence recently. Renders nothing for anyone
   * without an ownership record (kind 30177), so callers can drop it beside
   * any sender name without a guard — same contract as OfficialBadge.
   */
  import * as m from '$lib/paraglide/messages';

  /** @type {{ pubkey: string, records: Map<string, {ownerPubkey: string, name: string}>, ownerName?: string, online?: boolean, class_?: string }} */
  let { pubkey, records, ownerName = '', online = false, class_ = '' } = $props();

  const record = $derived(records.get(pubkey));
</script>

{#if record}
  <span
    class="badge shrink-0 gap-1 badge-xs badge-secondary {class_}"
    title={m.agent_badge_title({ owner: ownerName || record.ownerPubkey.slice(0, 8) })}
  >
    {#if online}
      <span
        class="inline-block h-1.5 w-1.5 rounded-full bg-success"
        aria-label={m.agent_badge_online()}
      ></span>
    {/if}
    {m.agent_badge_label()}
  </span>
{/if}
