<script>
  import { nip19 } from 'nostr-tools';

  let { formRef, sectionName } = $props();

  let naddr = $derived.by(() => {
    if (!formRef) return null;
    const parts = formRef.split(':');
    if (parts.length < 3) return null;
    const [kindStr, pubkey, ...identifierParts] = parts;
    const kind = parseInt(kindStr, 10);
    const identifier = identifierParts.join(':');
    try {
      return nip19.naddrEncode({ kind, pubkey, identifier, relays: [] });
    } catch {
      return null;
    }
  });
</script>

{#if naddr}
  <div class="mb-4 alert alert-info">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      class="h-6 w-6 shrink-0 stroke-current"
    >
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
    <div>
      <p class="font-medium">This section requires approval</p>
      <p class="text-sm opacity-80">
        Fill out the application form to request access to {sectionName}.
      </p>
    </div>
    <a href="/forms/{naddr}/respond" class="btn btn-sm btn-primary">Apply</a>
  </div>
{/if}
