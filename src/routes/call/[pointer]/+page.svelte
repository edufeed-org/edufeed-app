<!--
  /call/<group pointer>#<code> — guest link landing page (call passes).
  The code sits in the fragment so it never reaches a server or a Referer.
-->
<script>
  import { page } from '$app/state';
  import CallLanding from '$lib/components/groups/call/CallLanding.svelte';
  import { parseGroupInput } from '$lib/groups/groups.js';

  let { data } = $props();
  const pointer = $derived(parseGroupInput(data.rawPointer));
  // CallLanding reads the pass code from the hash once, at init: SPA
  // navigation to another link (or a new hash) must remount it, or it would
  // keep the previous link's channel state and code.
  const linkKey = $derived(`${data.rawPointer}${page.url.hash}`);
</script>

{#key linkKey}
  <CallLanding {pointer} />
{/key}
