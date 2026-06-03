<!--
  Nip05VerifiedBadge — display a user's `name@domain` NIP-05 identifier with a
  trust badge that reflects actual resolution against the domain's
  /.well-known/nostr.json.

  States:
  - verified  → green CheckIcon (`names[name]` matches the user's pubkey)
  - mismatch  → error-colored AlertIcon + strikethrough + muted text so the
                false claim is visually de-emphasized (anti-impersonation)
  - error     → muted AlertIcon + dimmed text + hover-explained tooltip.
                Covers typo domains (e.g. `…@edufeed.or`), 4xx/5xx, network
                failures, CORS. Softer than mismatch — we're not asserting
                the claim is false, only that we couldn't prove it true.
  - pending / idle → render the text only, no icon (avoid flicker while the
    verify call is in flight)

  Result is cached in-memory per (nip05, pubkey) pair across the session by
  `verifyNip05`, so repeated mounts of this component don't refetch.
-->

<script>
  import { CheckIcon, AlertIcon } from '$lib/components/icons';
  import { verifyNip05 } from '$lib/helpers/nip05-verify.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} Props
   * @property {string} pubkey
   * @property {string | undefined} nip05
   * @property {string} [class_]
   */

  /** @type {Props} */
  let { pubkey, nip05, class_ = '' } = $props();

  /** @type {'idle' | 'pending' | 'verified' | 'mismatch' | 'error'} */
  let status = $state('idle');

  $effect(() => {
    // Reset on prop change.
    status = 'idle';
    if (!pubkey || !nip05) return;
    status = 'pending';
    let cancelled = false;
    verifyNip05(nip05, pubkey).then((result) => {
      if (cancelled) return;
      status = result;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if nip05}
  <span class="inline-flex items-center gap-1 {class_}">
    {#if status === 'verified'}
      <span
        class="inline-flex text-success"
        data-testid="nip05-verified"
        aria-label={m.nip05_verified_label()}
      >
        <CheckIcon class_="w-3.5 h-3.5" />
      </span>
      <span class="truncate">{nip05}</span>
    {:else if status === 'mismatch'}
      <span
        class="inline-flex text-error"
        data-testid="nip05-mismatch"
        aria-label={m.nip05_mismatch_label()}
        title={m.nip05_mismatch_label()}
      >
        <AlertIcon class_="w-3.5 h-3.5" />
      </span>
      <span class="truncate text-base-content/50 line-through" title={m.nip05_mismatch_label()}>
        {nip05}
      </span>
    {:else if status === 'error'}
      <span
        class="inline-flex text-warning"
        data-testid="nip05-unverified"
        aria-label={m.nip05_unverified_label()}
        title={m.nip05_unverified_label()}
      >
        <AlertIcon class_="w-3.5 h-3.5" />
      </span>
      <span class="truncate text-base-content/60" title={m.nip05_unverified_label()}>
        {nip05}
      </span>
    {:else}
      <span class="truncate">{nip05}</span>
    {/if}
  </span>
{/if}
