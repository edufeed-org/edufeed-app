<script>
  import { untrack } from 'svelte';

  /**
   * Stand-in for the lazily loaded GroupCallStage: records its props only.
   * @type {{
   *   title?: string,
   *   onLeave?: () => void,
   *   onShowChat?: () => void,
   *   chatOpen?: boolean,
   *   onPopOut?: () => void,
   *   onPopIn?: () => void,
   *   onInvite?: () => void,
   *   registerView?: () => () => void
   * }}
   */
  let {
    title = '',
    onLeave = () => {},
    onShowChat = undefined,
    chatOpen = false,
    onPopOut = undefined,
    onPopIn = undefined,
    onInvite = undefined,
    registerView = undefined
  } = $props();

  // untracked like the real stage: the store's register writes its own $state
  $effect(() => untrack(() => registerView?.()));
</script>

<div data-testid="group-call-stage-stub" data-chat-open={chatOpen}>
  {title}
  <button type="button" data-testid="group-call-stage-stub-leave" onclick={onLeave}>leave</button>
  {#if onShowChat}
    <button type="button" data-testid="group-call-stage-stub-chat" onclick={onShowChat}>chat</button
    >
  {/if}
  {#if onPopOut}
    <button type="button" data-testid="group-call-stage-stub-popout" onclick={onPopOut}
      >pop out</button
    >
  {/if}
  {#if onPopIn}
    <button type="button" data-testid="group-call-stage-stub-popin" onclick={onPopIn}>pop in</button
    >
  {/if}
  {#if onInvite}
    <button type="button" data-testid="group-call-stage-stub-invite" onclick={onInvite}
      >invite</button
    >
  {/if}
</div>
