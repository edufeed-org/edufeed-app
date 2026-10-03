<!--
  CallCountPill — "● N im Anruf", the running-call mark in channel lists
  (design 1a): a soft success badge, shared by ChannelCallRoster (sidebar and
  rail rows) and ChannelCallBadge (overview cards) so the two never drift.
-->
<script>
  import * as m from '$lib/paraglide/messages';

  /** @type {{ count: number, testid?: string }} */
  let { count, testid = 'call-count-pill' } = $props();
</script>

<span
  class="badge shrink-0 gap-1 badge-soft badge-sm font-semibold whitespace-nowrap badge-success select-none"
  data-testid={testid}
>
  <span aria-hidden="true">●</span>
  {m.groups_call_people_in_call({ count })}
</span>
