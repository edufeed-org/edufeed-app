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
  import { encodeEventToNaddr, profileLink } from '$lib/helpers/nostrUtils.js';
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
  import { fetchEvents } from '$lib/loaders/base.js';
  import { getArticleRelays, getEducationalRelays } from '$lib/helpers/relay-helper.js';
  import { getLabelsWithFallback } from '$lib/helpers/educational/ambTransform.js';
  import { unique, uniqueBy } from '$lib/helpers/unique.js';
  import { getLocale } from '$lib/paraglide/runtime';
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

  // A lesson series (Termi): its parts, kind 30023 by address in `a`-tag order, as a table of contents.
  const isSeries = $derived(publication.type === 'lesson-series' && publication.parts.length > 0);
  let partEvents = $state.raw(/** @type {any[]} */ ([]));
  // the fetch ended: a part still not in the store is not found, no longer loading
  let partsFetched = $state(false);
  $effect(() => {
    if (!isSeries) return;
    partsFetched = false;
    const split = publication.parts.map((a) => a.split(':'));
    const filter = {
      kinds: [30023],
      authors: unique(split.map((p) => p[1])),
      '#d': unique(split.map((p) => p.slice(2).join(':')))
    };
    // the parts' own relay hints first, then the app's longform relays
    const hints = (event?.tags ?? [])
      .filter((/** @type {string[]} */ t) => t[0] === 'a' && t[1]?.startsWith('30023:') && t[2])
      .map((/** @type {string[]} */ t) => t[2]);
    const load = fetchEvents(unique([...hints, ...getArticleRelays()]), filter).subscribe({
      complete: () => (partsFetched = true)
    });
    const sub = eventStore
      .model(TimelineModel, filter)
      .subscribe((/** @type {any[]} */ events) => (partEvents = events || []));
    return () => {
      load.unsubscribe();
      sub.unsubscribe();
    };
  });
  /** @param {any} e */
  const addressOf = (e) =>
    `${e.kind}:${e.pubkey}:${e.tags.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] ?? ''}`;
  const contents = $derived(
    publication.parts.map((address) => {
      const part = partEvents.find((e) => addressOf(e) === address);
      return {
        address,
        title: part?.tags.find((/** @type {string[]} */ t) => t[0] === 'title')?.[1],
        naddr: part ? encodeEventToNaddr(part) : ''
      };
    })
  );

  // A kind 30142 by the same author that describes this series (`a` … `id`): its AMB badges.
  let describing = $state.raw(/** @type {any[]} */ ([]));
  $effect(() => {
    if (!isSeries || !event?.pubkey || !dTag) return;
    const filter = {
      kinds: [30142],
      authors: [event.pubkey],
      '#a': [`${event.kind}:${event.pubkey}:${dTag}`]
    };
    const load = fetchEvents(getEducationalRelays(), filter).subscribe();
    const sub = eventStore
      .model(TimelineModel, filter)
      .subscribe((/** @type {any[]} */ events) => (describing = events || []));
    return () => {
      load.unsubscribe();
      sub.unsubscribe();
    };
  });
  const ambBadges = $derived.by(() => {
    const tags = describing[0]?.tags;
    if (!tags) return [];
    const lang = getLocale();
    return uniqueBy(
      [
        ...getLabelsWithFallback(tags, 'educationalLevel', lang),
        ...getLabelsWithFallback(tags, 'teaches', lang)
      ],
      (/** @type {{ id: string }} */ c) => c.id
    );
  });

  const getHighlightProfiles = useProfileMap(() => highlights.map((h) => h.pubkey));

  // Creators with a Nostr identity keep the name written in the event (their
  // creator:* run, or an author tag); a lone `["p", pk, relay, "creator"]`
  // tag without one resolves its display name from the kind:0 profile.
  const getCreatorProfiles = useProfileMap(() =>
    publication.creators.flatMap((c) => (c.pubkey ? [c.pubkey] : []))
  );

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
    bookmark
  />

  <!-- Authors -->
  {#if publication.creators.length > 0}
    <section class="mb-6">
      <h2 class="mb-2 text-sm font-semibold text-base-content/70 uppercase">
        {m.publication_view_authors()}
      </h2>
      <ul class="space-y-1">
        <!-- Index key: names are tag-derived network input and may repeat or be empty -->
        {#each publication.creators as creator, i (i)}
          <li class="flex flex-wrap items-center gap-2">
            {#if creator.pubkey}
              {@const displayName =
                creator.name ||
                getDisplayName(
                  getCreatorProfiles().get(creator.pubkey),
                  creator.pubkey.slice(0, 8) + '…'
                )}
              <a class="font-medium link-hover" href={resolve(profileLink(creator.pubkey))}>
                {#if creator.honorificPrefix}{creator.honorificPrefix}
                {/if}{displayName}
              </a>
            {:else}
              <span class="font-medium">
                {#if creator.honorificPrefix}{creator.honorificPrefix}
                {/if}{creator.name}
              </span>
            {/if}
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

  {#if ambBadges.length > 0}
    <section class="mb-6 flex flex-wrap gap-2" data-testid="publication-amb-badges">
      {#each ambBadges as badge (badge.id)}
        <span class="badge badge-outline">{badge.label}</span>
      {/each}
    </section>
  {/if}

  <!-- Table of contents of a lesson series -->
  {#if isSeries}
    <section class="mb-6" data-testid="publication-contents">
      <h2 class="mb-2 text-sm font-semibold text-base-content/70 uppercase">
        {m.publication_view_contents()}
      </h2>
      <ol class="list-decimal space-y-1 pl-6">
        {#each contents as part (part.address)}
          <li>
            {#if part.naddr}
              <a class="link link-hover" href={resolve('/[naddr=naddr]', { naddr: part.naddr })}
                >{part.title || part.address.split(':').slice(2).join(':')}</a
              >
            {:else}
              <span class="text-base-content/50"
                >{partsFetched
                  ? m.publication_view_part_not_found()
                  : m.publication_view_part_loading()}</span
              >
            {/if}
          </li>
        {/each}
      </ol>
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

  <CommentList rootEvent={event} {activeUser} />
</article>
