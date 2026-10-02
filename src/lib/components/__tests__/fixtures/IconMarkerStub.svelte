<!-- Stand-in for an icon component: lets a test tell WHICH icon a slot drew. -->
<script>
  let { class_ = '' } = $props();
</script>

<span data-testid="icon-marker-stub" class={class_}></span>
