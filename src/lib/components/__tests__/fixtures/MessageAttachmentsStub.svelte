<!-- Captures the `attachments` prop ChannelChat passes to the real
     MessageAttachments (JSON on a data attribute — Testing Library asserts
     on DOM, not component internals). The real component's render behavior
     is covered by MessageAttachments.test.js. -->
<script>
  let { attachments = [] } = $props();
</script>

<div data-testid="message-attachments-stub" data-attachments={JSON.stringify(attachments)}></div>
