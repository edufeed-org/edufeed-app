<script>
  import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';

  let { licenseEvent = null, class: klass = '' } = $props();

  const licenseUrl = $derived(
    licenseEvent?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'license')?.[1] ?? null
  );
  const credit = $derived(
    licenseEvent?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'credit')?.[1] ?? null
  );
  const source = $derived(
    licenseEvent?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'source')?.[1] ?? null
  );
  const creatorP = $derived(
    licenseEvent?.tags.find(/** @param {string[]} t */ (t) => t[0] === 'p')?.[1] ?? null
  );

  const label = $derived(licenseUrl ? formatLicenseUrl(licenseUrl) : null);

  const title = $derived.by(() => {
    if (!licenseEvent) return '';
    const parts = [];
    if (credit) parts.push(`Credit: ${credit}`);
    if (source) parts.push(`Source: ${source}`);
    if (creatorP) parts.push(`Creator pubkey: ${creatorP}`);
    parts.push(`Attested by: ${licenseEvent.pubkey}`);
    return parts.join('\n');
  });
</script>

{#if licenseEvent && label}
  <span
    class="badge inline-flex max-w-full items-center gap-1 badge-ghost text-xs {klass}"
    {title}
    data-testid="license-badge"
  >
    <span class="shrink-0 font-medium">{label}</span>
    {#if credit}
      <span class="min-w-0 truncate opacity-70">· {credit}</span>
    {/if}
  </span>
{/if}
