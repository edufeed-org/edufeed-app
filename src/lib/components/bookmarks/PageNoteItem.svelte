<!--
  PageNoteItem — Single page note with blue left border
-->
<script>
  import { getDisplayName, getProfilePicture } from 'applesauce-core/helpers';

  /** @type {{ event: any, authorProfile?: any }} */
  let { event, authorProfile = null } = $props();

  const name = $derived(authorProfile ? getDisplayName(authorProfile) : 'Unknown');
  const avatar = $derived(authorProfile ? getProfilePicture(authorProfile) : null);
</script>

<div class="rounded-r-lg border-l-4 border-info bg-info/5 p-3">
  {#if event.content}
    <p class="text-sm text-base-content/90">{event.content}</p>
  {/if}
  <div class="mt-2 flex items-center gap-2">
    {#if avatar}
      <div class="avatar">
        <div class="w-4 rounded-full">
          <img src={avatar} alt={name} />
        </div>
      </div>
    {/if}
    <span class="text-xs text-base-content/60">{name}</span>
  </div>
</div>
