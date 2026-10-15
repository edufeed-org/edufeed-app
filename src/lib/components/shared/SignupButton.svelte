<script>
  import { modalStore } from '$lib/stores/modal.svelte.js';
  import * as m from '$lib/paraglide/messages';

  let { class: className = '' } = $props();
</script>

<button class="btn btn-secondary {className}" onclick={() => modalStore.openModal('signup')}>
  {m.auth_signup_button()}
</button>
