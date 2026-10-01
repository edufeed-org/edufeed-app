<!--
  /call/<group pointer>#<code> — guest link landing page (call passes).
  The code sits in the fragment so it never reaches a server or a Referer.
-->
<script>
  import CallLanding from '$lib/components/groups/call/CallLanding.svelte';
  import { parseGroupInput } from '$lib/groups/groups.js';

  let { data } = $props();
  const pointer = $derived(parseGroupInput(data.rawPointer));
</script>

<CallLanding {pointer} />
