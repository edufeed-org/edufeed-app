<!--
  CallUnreadDot — "something new in there" on the call chat tab, the stage's
  chat button, the dock and the channel tab while in a call. The dot is
  decoration; the sr-only label says it (inside an element that has its own
  aria-label, fold the label into that instead and pass `label=""`).
-->
<script>
  /** @type {{ label?: string, testid?: string, tone?: string, class?: string }} */
  // tone: the dot's colour token (on a primary button it must be the
  // button's content colour to show at all).
  let {
    label = '',
    testid = 'call-chat-unread-dot',
    tone = 'bg-primary',
    class: className = ''
  } = $props();
</script>

<span
  class="inline-block h-2 w-2 shrink-0 rounded-full {tone} {className}"
  aria-hidden="true"
  data-testid={testid}
></span>{#if label}<span class="sr-only">{label}</span>{/if}
