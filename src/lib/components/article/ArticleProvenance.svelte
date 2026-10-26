<!--
  ArticleProvenance — who wrote a NIP-23 article and under which terms.
  Credited people (authors and contributors), then the license card with the
  TULLU citation, the original source and the modification note. The source
  alone (a mirrored post without license) gets a one-line link. Renders
  nothing for an article that carries none of it (the common case).
  Wire form: $lib/helpers/article-attribution.js
-->

<script>
  import * as m from '$lib/paraglide/messages.js';
  import { resolve } from '$app/paths';
  import { getDisplayName } from 'applesauce-core/helpers';
  import { getArticleTitle } from 'applesauce-common/helpers';
  import { getArticlePeople, getArticleProvenance } from '$lib/helpers/article-attribution.js';
  import { buildTulluCitation, getCitationOrigin } from '$lib/helpers/educational/citation.js';
  import { creatorInitials } from '$lib/helpers/educational/resourceAttribution.js';
  import { profileLink } from '$lib/helpers/nostrUtils.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import ProfileAvatar from '../shared/ProfileAvatar.svelte';
  import CitationNote from '../educational/CitationNote.svelte';
  import { CheckIcon } from '$lib/components/icons';

  /**
   * @typedef {Object} Props
   * @property {any} event - Article event (kind 30023)
   * @property {string} pageUrl - This page's URL (citation origin for Nostr-native articles)
   * @property {string} appName - Deployment name (origin label for Nostr-native articles)
   */

  /** @type {Props} */
  let { event, pageUrl, appName } = $props();

  const people = $derived(
    getArticlePeople(event).map((p, i) => ({ ...p, key: `${i}:${p.pubkey || p.name || ''}` }))
  );
  const provenance = $derived(getArticleProvenance(event));

  const getProfiles = useProfileMap(() => people.flatMap((p) => (p.pubkey ? [p.pubkey] : [])));
  const getPublisherProfile = useUserProfile(() => event.pubkey);

  /** @param {import('$lib/helpers/article-attribution.js').ArticlePerson} person */
  function displayName(person) {
    if (person.pubkey) {
      return getDisplayName(getProfiles().get(person.pubkey), person.pubkey.slice(0, 8) + '…');
    }
    return [person.honorificPrefix, person.name].filter(Boolean).join(' ');
  }

  // TULLU: Urheber = credited creators (contributors are not cited); the
  // publisher stands in for own content. Ursprung = the original source when
  // the article was re-published, else this page.
  const citation = $derived.by(() => {
    if (!provenance.license) return null;
    const names = people.filter((p) => p.role === 'creator').map(displayName);
    const creators =
      names.length > 0
        ? names
        : [getDisplayName(getPublisherProfile(), event.pubkey.slice(0, 8) + '…')];
    return buildTulluCitation(
      {
        title: getArticleTitle(event) ?? '',
        creators,
        license: provenance.license,
        origin: getCitationOrigin({ primaryURL: provenance.source }, { pageUrl, appName })
      },
      m.amb_resource_citation_format
    );
  });
</script>

{#if people.length > 0 || provenance.license || provenance.source}
  <section class="article-provenance mb-8 space-y-4">
    {#if people.length > 0}
      <div data-testid="article-people">
        <h3 class="mb-2 text-sm font-medium text-base-content/70">{m.article_view_authors()}</h3>
        <ul class="flex flex-wrap gap-x-6 gap-y-3">
          {#each people as person (person.key)}
            <li class="flex items-center gap-2">
              {#if person.pubkey}
                <ProfileAvatar
                  pubkey={person.pubkey}
                  profile={getProfiles().get(person.pubkey)}
                  size="sm"
                  linkToProfile
                />
                <a
                  href={resolve(profileLink(person.pubkey))}
                  class="font-medium text-base-content hover:underline">{displayName(person)}</a
                >
              {:else}
                <span
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-base-content/40 text-xs font-medium text-base-content/70"
                  aria-hidden="true"
                >
                  {person.type === 'Organization' ? '🏢' : creatorInitials(person.name)}
                </span>
                <span class="font-medium text-base-content">{displayName(person)}</span>
              {/if}
              {#if person.role === 'contributor'}
                <span class="badge badge-outline badge-xs" data-testid="role-contributor">
                  {m.amb_resource_role_contributor()}
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if provenance.license}
      <div data-testid="article-license" class="rounded-lg border border-base-300 bg-base-100 p-4">
        <div class="flex flex-wrap items-center gap-3">
          <span class="badge gap-1 badge-primary">
            <CheckIcon class_="w-4 h-4" />
            {provenance.license.label}
          </span>
          <!-- eslint-disable svelte/no-navigation-without-resolve -- external: license + source URLs -->
          <a
            href={provenance.license.id}
            target="_blank"
            rel="noopener noreferrer license"
            class="link text-sm link-primary"
          >
            {m.amb_resource_view_license()}
          </a>
        </div>
        {#if provenance.source || provenance.changes}
          <dl class="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            {#if provenance.source}
              <dt class="text-base-content/70">{m.article_view_source()}</dt>
              <dd>
                <a
                  href={provenance.source}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="link break-all">{provenance.source}</a
                >
              </dd>
            {/if}
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
            {#if provenance.changes}
              <dt class="text-base-content/70">{m.article_view_changes()}</dt>
              <dd>{provenance.changes}</dd>
            {/if}
          </dl>
        {/if}
        {#if citation}
          <div class="mt-4 border-t border-dashed border-base-300 pt-4">
            <CitationNote {citation} />
          </div>
        {/if}
      </div>
    {:else if provenance.source}
      <!-- A mirror without license: still point readers to the original -->
      <p data-testid="article-source" class="text-sm">
        <span class="text-base-content/70">{m.article_view_source()}:</span>
        <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- external source URL -->
        <a href={provenance.source} target="_blank" rel="noopener noreferrer" class="link break-all"
          >{provenance.source}</a
        >
      </p>
    {/if}
  </section>
{/if}
