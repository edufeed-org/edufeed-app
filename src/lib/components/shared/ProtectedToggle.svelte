<!--
  ProtectedToggle — the composer switch for NIP-70 protected events.

  Off by default. When on, the composer adds the `["-"]` tag: only relays
  that authenticate the author (NIP-42) and enforce NIP-70 store it, and
  nobody else can rebroadcast it. The info button explains that (tooltip on
  hover, text on tap — touch has no hover).
-->
<script>
  import { InfoCircleIcon, LockIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ checked?: boolean, disabled?: boolean }} */
  let { checked = $bindable(false), disabled = false } = $props();

  let showHint = $state(false);
  const hintId = `protected-hint-${Math.random().toString(36).slice(2, 8)}`;
</script>

<div class="form-control" data-testid="protected-option">
  <div class="flex items-center gap-2">
    <label class="label cursor-pointer gap-2 p-0">
      <input
        type="checkbox"
        class="toggle toggle-primary toggle-sm"
        data-testid="protected-toggle"
        aria-describedby={hintId}
        bind:checked
        {disabled}
      />
      <LockIcon class_="w-4 h-4 text-base-content/70" />
      <span class="label-text">{m.protected_toggle_label()}</span>
    </label>
    <span class="tooltip tooltip-top" data-tip={m.protected_toggle_hint()}>
      <button
        type="button"
        class="btn btn-circle btn-ghost btn-xs"
        aria-label={m.protected_toggle_info_aria()}
        aria-expanded={showHint}
        aria-controls={hintId}
        data-testid="protected-info"
        onclick={() => (showHint = !showHint)}
      >
        <InfoCircleIcon class_="w-4 h-4" />
      </button>
    </span>
  </div>
  <p
    id={hintId}
    class="mt-1 text-xs text-base-content/70 {showHint ? '' : 'sr-only'}"
    data-testid="protected-hint"
  >
    {m.protected_toggle_hint()}
  </p>
</div>
