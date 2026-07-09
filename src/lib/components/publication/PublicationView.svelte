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
