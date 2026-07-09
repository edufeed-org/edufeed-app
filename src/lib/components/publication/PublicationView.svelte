<!--
  PublicationView Component
  Full page viewer for scientific publications (kind 30040, NKBIP-01 index
  events carrying edufeed's AMB-style extension tags).
-->

<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { encodeEventToNaddr } from '$lib/helpers/nostrUtils.js';
  import { showToast } from '$lib/helpers/toast.js';
  import { parsePublicationEvent } from '$lib/helpers/publication/publicationTags.js';
  import { doiUrl } from '$lib/helpers/publication/doi.js';
  import { formatLicenseUrl } from '$lib/helpers/educational/licenseLabel.js';
  import DetailHeader from '$lib/components/shared/DetailHeader.svelte';
  import EncodingPreview from '$lib/components/educational/EncodingPreview.svelte';
  import HighlightSelectionTooltip from '$lib/components/bookmarks/HighlightSelectionTooltip.svelte';
  import { loadEventHighlights } from '$lib/loaders/event-highlights.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { TimelineModel } from 'applesauce-core/models';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import ReactionBar from '$lib/components/reactions/ReactionBar.svelte';
  import CommentList from '$lib/components/comments/CommentList.svelte';
  import EventTags from '$lib/components/calendar/EventTags.svelte';
  import { ExternalLinkIcon } from '$lib/components/icons';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ event: any }} */
  let { event } = $props();

  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());
  const isAuthor = $derived(!!activeUser && activeUser.pubkey === event?.pubkey);

  const publication = $derived(parsePublicationEvent(event));

  // NIP-84 highlights: kind 9802 events referencing this publication via #a.
  const dTag = $derived(event?.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] ?? '');
  const highlightPointer = $derived(
    /** @type {import('nostr-tools/nip19').AddressPointer} */ ({
      kind: event?.kind ?? 30040,
      pubkey: event?.pubkey ?? '',
      identifier: dTag
    })
  );

  let highlights = $state.raw(/** @type {any[]} */ ([]));
  /** @type {HTMLElement | undefined} */
  let pdfContainer = $state();

  $effect(() => {
    if (!event?.pubkey || !dTag) return;

    const aTagValue = `${event.kind}:${event.pubkey}:${dTag}`;
    const { loader, cleanup } = loadEventHighlights(highlightPointer);
    loader();

    const modelSub = eventStore
      .model(TimelineModel, { kinds: [9802], '#a': [aTagValue] })
      .subscribe((/** @type {any[]} */ events) => {
        highlights = events || [];
      });

    return () => {
      cleanup();
      modelSub.unsubscribe();
    };
  });

  const getHighlightProfiles = useProfileMap(() => highlights.map((h) => h.pubkey));

  async function handleDelete() {
    if (!activeUser || !event) return;
    const result = await deleteEvent(event, activeUser);
    if (result.success) {
      showToast(m.publication_view_delete_success(), 'success');
      history.back();
    } else {
      showToast(result.error || m.toast_publish_failed(), 'error');
      throw new Error(result.error || 'Delete failed');
    }
  }

  function handleEdit() {
    const naddr = encodeEventToNaddr(event);
    if (naddr) {
      goto(resolve(`/create/publication?edit=${naddr}`));
    }
  }
</script>

<article class="publication-view mx-auto max-w-4xl">
  <DetailHeader
    title={publication.title}
    {event}
    authorPubkey={event.pubkey}
    date={publication.datePublished}
    dateLabel={m.publication_view_published()}
    onEdit={isAuthor ? handleEdit : undefined}
    onDelete={isAuthor ? handleDelete : undefined}
    deleteTitle={m.publication_view_delete_confirm_title()}
    deleteItemName={publication.title}
  />

  <!-- Authors -->
  {#if publication.creators.length > 0}
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-semibold text-base-content/70 uppercase">
        {m.publication_view_authors()}
      </h2>
      <ul class="space-y-1">
        {#each publication.creators as creator (creator.name)}
          <li class="flex flex-wrap items-center gap-2">
            <span class="font-medium">
              {#if creator.honorificPrefix}{creator.honorificPrefix}
              {/if}{creator.name}
            </span>
            {#if creator.affiliationName}
              <span class="text-sm text-base-content/60">({creator.affiliationName})</span>
            {/if}
            {#if creator.orcid}
              <a
                class="badge badge-outline badge-xs"
                href={creator.orcid}
                target="_blank"
                rel="noopener noreferrer"
                title="ORCID"
              >
                ORCID
              </a>
            {/if}
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- Venue / identifiers -->
  <section class="mb-6 flex flex-wrap items-center gap-3">
    {#if publication.journal}
      <span class="badge badge-ghost">{publication.journal}</span>
    {/if}
    {#if publication.inLanguage}
      <span class="badge badge-ghost uppercase">{publication.inLanguage}</span>
    {/if}
    {#if publication.license}
      <span class="badge badge-ghost">{formatLicenseUrl(publication.license)}</span>
    {/if}
    {#if publication.doi}
      <a
        class="btn btn-outline btn-xs"
        href={doiUrl(publication.doi)}
        target="_blank"
        rel="noopener noreferrer"
      >
        DOI: {publication.doi}
      </a>
    {/if}
    {#if publication.url}
      <a
        class="btn gap-1 btn-xs btn-primary"
        href={publication.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <ExternalLinkIcon class_="w-3 h-3" />
        {m.publication_view_open_article()}
      </a>
    {/if}
    {#if publication.file}
      <a
        class="btn gap-1 btn-outline btn-xs"
        href={publication.file.url}
        target="_blank"
        rel="noopener noreferrer"
      >
        <ExternalLinkIcon class_="w-3 h-3" />
        {m.publication_view_open_file()}
      </a>
    {/if}
  </section>

  <!-- Abstract -->
  {#if publication.abstract}
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-semibold text-base-content/70 uppercase">
        {m.publication_view_abstract()}
      </h2>
      <p class="whitespace-pre-line text-base-content/90">{publication.abstract}</p>
    </section>
  {/if}

  <!-- Subjects -->
  {#if publication.subjects.length > 0}
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-semibold text-base-content/70 uppercase">
        {m.publication_view_subjects()}
      </h2>
      <div class="flex flex-wrap gap-2">
        {#each publication.subjects as subject (subject.id)}
          <span class="badge badge-outline">{subject.label}</span>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Article file preview (inline PDF via pdf.js / image). The wrapper is
       the selection scope for NIP-84 highlighting on the PDF text layer. -->
  {#if publication.file}
    <section class="relative mb-6" bind:this={pdfContainer}>
      <EncodingPreview
        url={publication.file.url}
        mimeType={publication.file.mimeType ?? ''}
        name={publication.title || publication.file.url.split('/').pop() || 'file'}
      />
      {#if pdfContainer && activeUser}
        <HighlightSelectionTooltip
          container={pdfContainer}
          source={highlightPointer}
          {activeUser}
        />
      {/if}
    </section>
  {/if}

  <!-- Highlights on this publication -->
  {#if highlights.length > 0}
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-semibold text-base-content/70 uppercase">
        {m.publication_view_highlights()}
      </h2>
      <ul class="space-y-3">
        {#each highlights as highlight (highlight.id)}
          <li class="border-l-4 border-warning/60 pl-3">
            <blockquote class="text-base-content/90 italic">“{highlight.content}”</blockquote>
            <div class="mt-1 text-xs text-base-content/60">
              {getDisplayName(
                getHighlightProfiles().get(highlight.pubkey),
                highlight.pubkey.slice(0, 8) + '…'
              )}
              · {formatCalendarDate(new Date(highlight.created_at * 1000), 'short')}
            </div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <!-- Keywords -->
  {#if publication.keywords.length > 0}
    <section class="mb-6">
      <EventTags tags={publication.keywords} size="xs" targetRoute="/discover" />
    </section>
  {/if}

  <!-- Reactions -->
  <div class="mb-8 border-y border-base-300 py-4">
    <ReactionBar {event} />
  </div>

  <!-- Comments -->
  <div class="mt-8">
    <h2 class="mb-4 text-2xl font-bold text-base-content">{m.article_view_comments()}</h2>
    <CommentList rootEvent={event} {activeUser} />
  </div>
</article>
