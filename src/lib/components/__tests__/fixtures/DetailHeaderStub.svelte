<!-- Marks where CalendarEventDetailView rendered its DetailHeader (the
     edit/delete/share menu lives inside the real one). -->
<script>
  let { onEdit = undefined } = $props();
</script>

<div data-testid="detail-header-stub" data-can-edit={String(!!onEdit)}></div>
