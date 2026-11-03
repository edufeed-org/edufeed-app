<!-- Stand-in for CalendarEventDetailView in the /calendar/event route test:
  shows which revision the route hands down. -->
<script>
  let { event, rawEvent } = $props();
</script>

<div data-testid="calendar-event-detail-stub">{event?.title ?? 'none'}|{rawEvent?.id ?? ''}</div>
