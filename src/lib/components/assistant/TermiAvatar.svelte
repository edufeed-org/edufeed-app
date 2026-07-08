<script>
  /** @type {{ size?: number }} */
  let { size = 30 } = $props();
</script>

<span
  class="grid shrink-0 place-items-center overflow-hidden rounded-full border border-base-300 bg-base-100"
  style="width:{size}px;height:{size}px"
>
  <img src="/termi.png" alt="" style="width:78%;height:78%;object-fit:contain" />
</span>
