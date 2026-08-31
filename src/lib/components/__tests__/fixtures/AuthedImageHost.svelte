<!-- Sets the group-media-auth context around ImageWithFallback, the way
     GroupChat does, so the authed-media stage can be tested. -->
<script>
  import { setContext } from 'svelte';
  import { GROUP_MEDIA_AUTH } from '$lib/groups/authed-media.js';
  import ImageWithFallback from '$lib/components/shared/ImageWithFallback.svelte';

  let { relay, user, src, alt = 'x' } = $props();
  setContext(GROUP_MEDIA_AUTH, { relay, getUser: () => user });
</script>

<ImageWithFallback {src} {alt} size="avatar_sm" class="h-8 w-8" />
