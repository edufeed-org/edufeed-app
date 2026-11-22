<script>
  // A Selbstlernmodul played by the official LiaScript player (parent mode): the player
  // asks its parent for the course text over postMessage; nothing is written to a relay.
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { sha256Hex } from '$lib/helpers/sha256.js';
  import { playerMarkdown } from '../document-export.js';

  const PLAYER = 'https://liascript.github.io';

  /** @type {{ markdown: string }} */
  let { markdown } = $props();

  const body = $derived(playerMarkdown(markdown));
  // the player keeps progress per course address: a content hash, so a changed text is a new course
  let id = $state('');
  $effect(() => {
    const text = body;
    sha256Hex(new Blob([text])).then((h) => {
      if (text === body) id = h.slice(0, 16);
    });
  });

  /** @type {HTMLIFrameElement | undefined} */
  let frame = $state();

  onMount(() => {
    /** @param {MessageEvent} e */
    const onMessage = (e) => {
      const win = frame?.contentWindow;
      const param = e.data?.param;
      if (e.origin !== PLAYER || !win || e.source !== win) return;
      if (e.data?.cmd !== 'lia-course' || param?.uri !== `parent:${id}` || 'ok' in param) return;
      win.postMessage({ cmd: 'lia-course', param: { uri: param.uri, ok: true, body } }, PLAYER);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  });
</script>

{#if id}
  {#key id}
    <iframe
      bind:this={frame}
      data-testid="lia-frame"
      title={m.termi_werkbank_course_title()}
      src="{PLAYER}/course/?parent:{id}"
      sandbox="allow-scripts allow-same-origin"
      referrerpolicy="no-referrer"
      class="h-[70vh] w-full rounded border border-base-300 bg-base-100"
    ></iframe>
  {/key}
{/if}
