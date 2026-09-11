<!--
  LicenseInfoCard
  Readable body of the license-badge popover: what a kind-1063 attestation
  says about an image — license (linked), credit, title, description/alt,
  source (linked when http(s)), the creator (`p` tag) and the attester
  (event author) as profile names linking to their profiles.

  Pubkeys never render as raw hex: while a profile is unknown the shortened
  npub stands in. Profiles are subscribed only while this card is mounted,
  i.e. while the popover is open — cards in long lists cost nothing.
-->
<script>
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';
  import { getAiLabel } from '$lib/helpers/ai-label.js';
  import { hexToNpub, normalizePubkey } from '$lib/helpers/pubkey.js';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { AiLabelIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ licenseEvent: import('nostr-tools').NostrEvent }} */
  let { licenseEvent } = $props();

  /** @param {string} name */
  const tag = (name) =>
    licenseEvent.tags.find(/** @param {string[]} t */ (t) => t[0] === name && t[1])?.[1] ?? null;

  const licenseUrl = $derived(tag('license'));
  const credit = $derived(tag('credit'));
  const title = $derived(tag('title'));
  const alt = $derived(tag('alt'));
  const source = $derived(tag('source'));
  const creator = $derived(normalizePubkey(tag('p')));
  const attester = $derived(normalizePubkey(licenseEvent.pubkey));
  const aiLabel = $derived(getAiLabel(licenseEvent));
  const aiText = $derived(
    aiLabel === 'generated'
      ? m.image_ai_label_generated()
      : aiLabel === 'modified'
        ? m.image_ai_label_modified()
        : null
  );

  /** @param {string | null} url */
  const isHttpUrl = (url) => /^https?:\/\//i.test(url ?? '');

  const getProfiles = useProfileMap(() =>
    [creator, attester].filter(/** @returns {pk is string} */ (pk) => Boolean(pk))
  );

  /** @param {string} pubkey */
  function nameFor(pubkey) {
    const name = getDisplayName(getProfiles().get(pubkey));
    if (name) return name;
    const npub = hexToNpub(pubkey) ?? '';
    return `${npub.slice(0, 12)}…`;
  }
</script>

<div class="w-72 max-w-[calc(100vw-2rem)] p-3 text-left text-xs" data-testid="license-info-card">
  <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
    {#if aiText}
      <dt class="text-base-content/60">{m.license_modal_ai_label()}</dt>
      <dd
        class="inline-flex items-center gap-1 font-medium text-base-content"
        data-testid="license-info-ai"
      >
        <AiLabelIcon class_="h-3.5 w-3.5 shrink-0" title="" />
        {aiText}
      </dd>
    {/if}
    {#if licenseUrl}
      <dt class="text-base-content/60">{m.license_modal_license_label()}</dt>
      <dd class="min-w-0">
        {#if isHttpUrl(licenseUrl)}
          <a
            href={licenseUrl}
            target="_blank"
            rel="noopener noreferrer license"
            class="link font-medium break-words link-primary"
            data-testid="license-info-license">{formatLicenseUrl(licenseUrl)}</a
          >
        {:else}
          <span class="font-medium break-words" data-testid="license-info-license"
            >{formatLicenseUrl(licenseUrl)}</span
          >
        {/if}
      </dd>
    {/if}
    {#if credit}
      <dt class="text-base-content/60">{m.license_info_credit()}</dt>
      <dd class="min-w-0 break-words text-base-content" data-testid="license-info-credit">
        {credit}
      </dd>
    {/if}
    {#if title}
      <dt class="text-base-content/60">{m.license_modal_title_label()}</dt>
      <dd class="min-w-0 break-words text-base-content" data-testid="license-info-title">
        {title}
      </dd>
    {/if}
    {#if alt}
      <dt class="text-base-content/60">{m.license_info_alt()}</dt>
      <dd class="min-w-0 break-words text-base-content" data-testid="license-info-alt">{alt}</dd>
    {/if}
    {#if source}
      <dt class="text-base-content/60">{m.license_info_source()}</dt>
      <dd class="min-w-0">
        {#if isHttpUrl(source)}
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            class="link break-all link-primary"
            data-testid="license-info-source">{source}</a
          >
        {:else}
          <span class="break-all" data-testid="license-info-source">{source}</span>
        {/if}
      </dd>
    {/if}
    {#if creator}
      <dt class="text-base-content/60">{m.license_info_creator()}</dt>
      <dd class="min-w-0">
        <a
          href={resolve(profileLink(creator))}
          class="link truncate font-medium text-base-content hover:link-primary"
          data-testid="license-info-creator">{nameFor(creator)}</a
        >
      </dd>
    {/if}
    {#if attester}
      <dt class="text-base-content/60">{m.license_modal_attested_by()}</dt>
      <dd class="min-w-0">
        <a
          href={resolve(profileLink(attester))}
          class="link truncate font-medium text-base-content hover:link-primary"
          data-testid="license-info-attester">{nameFor(attester)}</a
        >
      </dd>
    {/if}
  </dl>
</div>
