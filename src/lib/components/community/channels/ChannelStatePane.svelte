<script>
  /** Generic centered state card: syncing / removed / dissolved / join / error. */
  let {
    icon = undefined,
    title,
    body = '',
    small = '',
    progress = false,
    children = undefined
  } = $props();
</script>

<div class="grid flex-1 place-items-center p-6">
  <div class="max-w-md rounded-2xl border border-base-300 bg-base-100 p-8 text-center">
    {#if icon}<div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-base-200">
        {@render icon()}
      </div>{/if}
    <h3 class="mb-2 text-lg font-extrabold">{title}</h3>
    {#if body}<p class="text-sm leading-relaxed text-base-content/70">{body}</p>{/if}
    {#if progress}
      <progress class="progress mt-4 w-full progress-primary"></progress>
    {/if}
    {#if small}<p class="mt-2 text-xs text-base-content/50">{small}</p>{/if}
    {#if children}{@render children()}{/if}
  </div>
</div>
