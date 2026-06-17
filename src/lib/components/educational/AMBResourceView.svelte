<!--
  AMBResourceView Component
  Full page viewer for AMB educational resources (kind 30142)
  Follows Nostr-first approach with comments/reactions as primary interaction
-->

<script>
  import { getProfilePicture, getDisplayName } from 'applesauce-core/helpers';
  import { formatCalendarDate } from '$lib/helpers/calendar.js';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { runtimeConfig } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { nip19 } from 'nostr-tools';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import ReactionBar from '../reactions/ReactionBar.svelte';
  import BookmarkButton from '../bookmarks/BookmarkButton.svelte';
  import CommentList from '../comments/CommentList.svelte';
  import EventTags from '../calendar/EventTags.svelte';

  import { getLocale } from '$lib/paraglide/runtime.js';
  import {
    getLabelsWithFallback,
    getLanguageDisplayName
  } from '$lib/helpers/educational/ambTransform.js';
  import { getCachedConcepts, ensureVocabularyLoaded } from '$lib/stores/skos-cache.svelte.js';
  import MetadataCardGrid from './MetadataCardGrid.svelte';
  import { buildAMBJsonLd } from '$lib/helpers/educational/ambJsonLd.js';
  import { parseExtensionTags } from '$lib/helpers/educational/parseExtensionTags.js';
  import {
    buildExtensionSections,
    buildExtensionCards
  } from '$lib/helpers/educational/extensionMetadata.js';
  import { eventStore } from '$lib/stores/nostr-infrastructure.svelte';
  import { addressLoader } from '$lib/loaders/base.js';
  import { getCommunikeyRelays } from '$lib/helpers/relay-helper.js';
  import {
    splitTitle,
    guardScriptAccent,
    summarizeExtensionFacets
  } from '$lib/helpers/educational/resourceDetailView.js';
  import { toDieBibelUrl } from '$lib/helpers/educational/bibleReference.js';
  import { ALL_VARIANTS, EXTENSION_NAMESPACE_LABELS } from '$lib/config/resource-form-variants.js';
  import { page } from '$app/stores';
  import * as m from '$lib/paraglide/messages.js';
  import MarkdownRenderer from '../shared/MarkdownRenderer.svelte';
  import { getFormReferenceFromResource } from '$lib/helpers/form-to-amb.js';
  import { deleteEvent } from '$lib/helpers/eventDeletion.js';
  import { showToast } from '$lib/helpers/toast.js';
  import {
    EditIcon,
    ExternalLinkIcon,
    GraduationCapIcon,
    BookIcon,
    BookClosedIcon,
    GlobeIcon,
    LinkIcon,
    TranslateIcon,
    PeopleIcon,
    LightningIcon,
    TagIcon,
    FilesIcon,
    ArrowLeftRightIcon,
    InfoCircleIcon,
    CheckIcon
  } from '$lib/components/icons';
  import DetailHeader from '../shared/DetailHeader.svelte';
  import DeleteConfirmModal from '../shared/DeleteConfirmModal.svelte';
  import EncodingRowBadge from './EncodingRowBadge.svelte';
  import EncodingPreview from './EncodingPreview.svelte';
  import ResourceCover from './ResourceCover.svelte';

  // Trigger SKOS vocabulary loading for label resolution
  ensureVocabularyLoaded('learningResourceType');
  ensureVocabularyLoaded('about');

  /**
   * @typedef {Object} Props
   * @property {any} event - Raw Nostr event (kind 30142)
   * @property {any} resource - Formatted resource object (from formatAMBResource)
   */

  /** @type {Props} */
  let { event, resource } = $props();

  // Reactive SKOS concepts for URI-to-label resolution
  const resourceTypeConcepts = $derived(getCachedConcepts('learningResourceType'));
  const aboutConcepts = $derived(getCachedConcepts('about'));

  // Language-aware labels - reactive to locale changes and SKOS cache!
  // Fallback chain: user's language → English → SKOS concept → URI label
  const localizedLearningResourceTypes = $derived(
    getLabelsWithFallback(event.tags, 'learningResourceType', getLocale(), resourceTypeConcepts)
  );
  const localizedSubjects = $derived(
    getLabelsWithFallback(event.tags, 'about', getLocale(), aboutConcepts)
  );
  const localizedEducationalLevels = $derived(
    getLabelsWithFallback(event.tags, 'educationalLevel', getLocale())
  );
  // AMB target audience (Zielgruppe) — surfaced first in the hero when present.
  const localizedAudiences = $derived(getLabelsWithFallback(event.tags, 'audience', getLocale()));

  // Get active user (reactive to login/logout)
  const getActiveUser = useActiveUser();
  const activeUser = $derived(getActiveUser());

  // Delete state
  let showDeleteConfirmation = $state(false);
  let isDeleting = $state(false);

  // Check if current user owns this resource
  const isOwner = $derived(activeUser?.pubkey === event.pubkey);

  /**
   * Handle edit button click - navigate to edit page
   */
  function handleEditClick() {
    const dTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    const editNaddr = nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier: dTag
    });
    goto(resolve(`/create/resource?edit=${editNaddr}`));
  }

  // Form back-reference: if the resource was produced by a kind-30168 form, offer
  // "Edit in form" that routes through the form-driven create-resource page.
  const formRef = $derived(getFormReferenceFromResource(event));

  function handleEditInFormClick() {
    if (!formRef) return;
    const [kindStr, pubkey, identifier] = formRef.address.split(':');
    const formNaddr = nip19.naddrEncode({
      kind: Number(kindStr),
      pubkey,
      identifier,
      relays: formRef.relay ? [formRef.relay] : undefined
    });
    const dTag = event.tags?.find((/** @type {string[]} */ t) => t[0] === 'd')?.[1] || '';
    const editNaddr = nip19.naddrEncode({
      kind: event.kind,
      pubkey: event.pubkey,
      identifier: dTag
    });
    goto(resolve(`/forms/${formNaddr}/create-resource?edit=${editNaddr}`));
  }

  /**
   * Handle resource deletion
   */
  async function handleDeleteResource() {
    if (!activeUser || !event) return;

    isDeleting = true;
    try {
      const result = await deleteEvent(event, activeUser);

      if (result.success) {
        showToast(m.toast_resource_deleted(), 'success');
        showDeleteConfirmation = false;
        // Navigate to discover page
        goto(resolve('/discover'));
      } else {
        showToast(result.error || m.toast_resource_delete_failed(), 'error');
      }
    } catch (error) {
      console.error('Failed to delete resource:', error);
      showToast(m.toast_resource_delete_error(), 'error');
    } finally {
      isDeleting = false;
    }
  }

  // Parse related resources from marker 'a' tags (hasPart / isPartOf / …).
  // Only a-tags with a relation marker in slot 3 are treated as related
  // resources — bare `a`-tags are ignored so we don't pick up unrelated refs.
  const relatedResources = $derived.by(() => {
    return (
      event.tags
        ?.filter((/** @type {any} */ t) => t[0] === 'a' && t[3])
        .map((/** @type {any} */ t) => {
          try {
            const coord = t[1] ?? '';
            // Bounded split so URL d-tags (containing ':') survive intact.
            const i = coord.indexOf(':');
            const j = i >= 0 ? coord.indexOf(':', i + 1) : -1;
            if (i < 0 || j < 0) return null;
            const kind = coord.slice(0, i);
            const pubkey = coord.slice(i + 1, j);
            const identifier = coord.slice(j + 1);
            if (!kind || !pubkey) return null;
            const relayHint = t[2]; // a-tag format: ['a', 'kind:pubkey:d-tag', 'relay-hint', marker]
            return {
              naddr: nip19.naddrEncode({
                kind: parseInt(kind),
                pubkey,
                identifier,
                relays: relayHint ? [relayHint] : undefined
              }),
              raw: coord,
              label: identifier || coord
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) || []
    );
  });

  // Parse creators from event tags (p-tags)
  const creators = $derived.by(() => {
    const creatorPubkeys =
      event.tags
        ?.filter((/** @type {any} */ t) => t[0] === 'p')
        .map((/** @type {any} */ t) => t[1]) || [];

    return creatorPubkeys.map((/** @type {string} */ pubkey) => ({
      pubkey,
      hasProfile: true
    }));
  });

  // Published date
  const publishedAt = $derived(
    resource.publishedDate ? new Date(resource.publishedDate * 1000) : null
  );

  // Hero title split into a main / script-accent / tail for the editorial
  // treatment. Only splits on word boundaries (see helper). The accent is
  // suppressed for long titles, which break badly in the Caveat block.
  const titleParts = $derived(
    guardScriptAccent(splitTitle(resource.name ?? ''), resource.name ?? '')
  );
  // Shrink very long titles so they fit the hero band without excessive wrapping.
  const titleSizeClass = $derived.by(() => {
    const n = (resource.name ?? '').length;
    if (n > 110) return 'is-xlong';
    if (n > 60) return 'is-long';
    return '';
  });

  // Primary content-type badge shown in the slim toolbar (design's "Stundenentwurf").
  const primaryTypeLabel = $derived(localizedLearningResourceTypes[0]?.label ?? '');

  // Concise extension facts (duration, method, …) to surface in the hero strip,
  // on top of the core educational fields. Full extension metadata still renders
  // in <ExtensionMetadataPanel> below.
  const extensionFacts = $derived(
    summarizeExtensionFacets(parseExtensionTags(event), { limit: 3, locale: getLocale() })
  );

  // Resolve a referenced kind-30168 form (if any) so extension facets get the
  // form authors field labels. Pure label/icon/wrap/chip logic lives in
  // extensionMetadata.js; only this network lookup is impure, so it stays here.
  // (`formRef` is declared above for the "Edit in form" action.)
  const formCoord = $derived(parseFormCoord(formRef?.address));
  let formEvent = $state(/** @type {any} */ (null));
  $effect(() => {
    formEvent = null;
    if (!formCoord) return;
    const { pubkey, identifier } = formCoord;
    const relays = [...(formRef?.relay ? [formRef.relay] : []), ...getCommunikeyRelays()];
    const loaderSub = addressLoader({ kind: 30168, pubkey, identifier, relays }).subscribe();
    const modelSub = eventStore
      .replaceable(30168, pubkey, identifier)
      .subscribe((/** @type {any} */ ev) => {
        if (ev) formEvent = ev;
      });
    return () => {
      loaderSub.unsubscribe();
      modelSub.unsubscribe();
    };
  });

  /**
   * @param {string | undefined} address  e.g. "30168:<pub>:<d>"
   * @returns {{ pubkey: string, identifier: string } | null}
   */
  function parseFormCoord(address) {
    if (!address) return null;
    const parts = address.split(':');
    if (parts.length < 3 || parts[0] !== '30168') return null;
    return { pubkey: parts[1], identifier: parts.slice(2).join(':') };
  }

  /**
   * Build one core (non-extension) metadata card from a list of localized
   * concept labels, folding any fallback-language hints into a muted suffix.
   * @param {string} key
   * @param {string} iconKey
   * @param {string} label
   * @param {{ label: string, fallbackLang?: string }[]} items
   * @returns {import('$lib/helpers/educational/extensionMetadata.js').MetadataCard}
   */
  function coreConceptCard(key, iconKey, label, items) {
    const value = items.map((i) => i.label).join(', ');
    const langs = [
      ...new Set(
        items
          .map((i) => i.fallbackLang)
          .filter((/** @type {string | undefined} */ l) => !!l)
          .map((l) => getLanguageDisplayName(/** @type {string} */ (l), getLocale()))
      )
    ];
    return { key, iconKey, label, value, valueMuted: langs.length ? `(${langs.join(', ')})` : '' };
  }

  // Unified metadata card model: core educational facts first, then extension
  // facets (in registration order). Rendered as one olive grid by MetadataCardGrid.
  const metadataCards = $derived.by(() => {
    /** @type {import('$lib/helpers/educational/extensionMetadata.js').MetadataCard[]} */
    const core = [];
    if (localizedEducationalLevels.length > 0) {
      core.push(
        coreConceptCard(
          'core:level',
          'graduationCap',
          m.amb_resource_educational_level(),
          localizedEducationalLevels
        )
      );
    }
    if (localizedSubjects.length > 0) {
      core.push(
        coreConceptCard('core:subjects', 'book', m.amb_resource_subjects(), localizedSubjects)
      );
    }
    if (resource.languages.length > 0) {
      core.push({
        key: 'core:languages',
        iconKey: 'translate',
        label: m.amb_resource_available_languages(),
        value: resource.languages.map((/** @type {string} */ l) => l.toUpperCase()).join(' · ')
      });
    }
    core.push({
      key: 'core:access',
      iconKey: resource.isFree ? 'lockOpen' : 'lock',
      label: m.amb_resource_access(),
      value: resource.isFree ? m.amb_resource_free() : m.amb_resource_paid()
    });

    const sections = buildExtensionSections(event, formEvent);
    const ext = buildExtensionCards(sections, getLocale());
    return [...core, ...ext];
  });

  /**
   * camelCase / kebab-case facet id → Title Case label (no i18n available for
   * arbitrary deployment facets).
   * @param {string} s
   */
  function humanizeFacet(s) {
    if (!s) return '';
    return s
      .replace(/[-_:]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  // Registered-variant extension labels keyed by namespace id (e.g. "ekw"),
  // mirroring ExtensionMetadataPanel so hero facets get localized labels.
  const variantExtLabels = new Map(
    ALL_VARIANTS.filter((v) => v.extensionLabels).map((v) => [v.id, v.extensionLabels])
  );

  /**
   * Resolve a localized label for an extension facet, matching the panel's
   * priority: namespace registry → registered variant → humanized fallback.
   * @param {string} ns
   * @param {string} facetName
   */
  function resolveFacetLabel(ns, facetName) {
    const nsLabels = EXTENSION_NAMESPACE_LABELS[ns] ?? variantExtLabels.get(ns);
    const key = nsLabels?.facets?.[facetName];
    if (key) {
      const fn = /** @type {Record<string, any>} */ (m)[key];
      if (typeof fn === 'function') return fn();
    }
    return humanizeFacet(facetName);
  }

  // The hero's key-fact strip: real core fields first, then extension facts.
  // Each entry carries an icon key the template maps to an icon component.
  const heroFacts = $derived.by(() => {
    /** @type {{ key: string, icon: string, label: string, value: string, href?: string, refs?: { text: string, href?: string }[] }[]} */
    const facts = [];
    // Audience (Zielgruppe) leads when present — most useful at a glance.
    if (localizedAudiences.length > 0) {
      facts.push({
        key: 'audience',
        icon: 'audience',
        label: m.amb_resource_target_audience(),
        value: localizedAudiences.map((/** @type {any} */ a) => a.label).join(', ')
      });
    }
    if (localizedEducationalLevels.length > 0) {
      facts.push({
        key: 'level',
        icon: 'level',
        label: m.amb_resource_educational_level(),
        value: localizedEducationalLevels.map((/** @type {any} */ l) => l.label).join(', ')
      });
    }
    if (localizedSubjects.length > 0) {
      facts.push({
        key: 'subject',
        icon: 'subject',
        label: m.amb_resource_subjects(),
        value: localizedSubjects.map((/** @type {any} */ s) => s.label).join(', ')
      });
    }
    for (const f of extensionFacts) {
      if (facts.length >= 5) break;
      const isBibleRef = f.facetName === 'bibleReference';
      const value = f.kind === 'boolean' ? '✓' : f.value;
      facts.push({
        key: `${f.ns}:${f.facetName}`,
        icon: isBibleRef ? 'bibleRef' : 'ext',
        label: resolveFacetLabel(f.ns, f.facetName),
        value,
        // Bible references list every passage as its own die-bibel.de link,
        // mirroring the metadata panel rather than surfacing only the first.
        refs: isBibleRef
          ? f.items.map((/** @type {string} */ v) => ({
              text: v,
              href: toDieBibelUrl(v) ?? undefined
            }))
          : undefined,
        href:
          isBibleRef && f.items.length === 1 ? (toDieBibelUrl(f.items[0]) ?? undefined) : undefined
      });
    }
    // Language is least important — appended last, only if a slot remains.
    if (resource.languages?.length > 0 && facts.length < 5) {
      facts.push({
        key: 'language',
        icon: 'language',
        label: m.amb_resource_available_languages(),
        value: resource.languages.map((/** @type {string} */ l) => l.toUpperCase()).join(' · ')
      });
    }
    return facts;
  });

  const HERO_ICONS = /** @type {Record<string, any>} */ ({
    audience: PeopleIcon,
    level: GraduationCapIcon,
    subject: BookIcon,
    language: TranslateIcon,
    bibleRef: BookClosedIcon,
    ext: LightningIcon
  });

  /**
   * @param {string} key
   */
  function heroIcon(key) {
    return HERO_ICONS[key] ?? InfoCircleIcon;
  }

  // JSON-LD structured data for SEO
  const pageUrl = $derived($page.url.href);
  const jsonLd = $derived(buildAMBJsonLd(event, resource, pageUrl));
  // Pre-computed script tag to avoid ESLint parsing issues with template literals
  // Split closing tag to prevent parser from thinking script block is ending
  const jsonLdScriptTag = $derived(
    '<script type="application/ld+json">' + JSON.stringify(jsonLd) + '</' + 'script>'
  );

  // Content type detection
  // Check if d-tag (identifier) contains a URL - this means the resource itself IS an external link
  const hasIdentifierUrl = $derived(
    resource.identifier?.startsWith('http://') || resource.identifier?.startsWith('https://')
  );
  // Check if r-tags contain external reference URLs (for display)
  const hasExternalRefs = $derived(resource.externalUrls && resource.externalUrls.length > 0);
  const hasUploadedFiles = $derived(resource.encodings && resource.encodings.length > 0);
  const isNostrNativeOnly = $derived(hasUploadedFiles && !hasIdentifierUrl);

  /**
   * Navigate to content URL (from d-tag identifier)
   */
  function navigateToContent() {
    if (!resource.identifier) return;
    window.open(resource.identifier, '_blank', 'noopener,noreferrer');
  }

  /**
   * Format file size for display
   * @param {number} bytes
   * @returns {string}
   */
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  /**
   * Get file icon based on MIME type
   * @param {string} mimeType
   * @returns {string}
   */
  function getFileIcon(mimeType) {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType.includes('pdf')) return '📄';
    if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📽️';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';
    return '📎';
  }
</script>

<svelte:head>
  <title>{resource.name} - {runtimeConfig.appName}</title>
  <meta
    name="description"
    content={resource.description || `Educational resource on ${runtimeConfig.appName}`}
  />
  <!-- eslint-disable-next-line svelte/no-at-html-tags -- safe: JSON.stringify output -->
  {@html jsonLdScriptTag}
</svelte:head>

<article class="amb-detail mx-auto max-w-4xl">
  <DetailHeader
    {event}
    authorPubkey={event.pubkey}
    date={publishedAt ? formatCalendarDate(publishedAt, 'short') : undefined}
    dateLabel={publishedAt ? m.amb_resource_published_label() : undefined}
    onEdit={isOwner ? handleEditClick : undefined}
    onDelete={isOwner
      ? () => {
          showDeleteConfirmation = true;
        }
      : undefined}
    deleteTitle={m.common_delete() + '?'}
    deleteItemName={resource.name}
  >
    {#snippet metadata()}
      {#if primaryTypeLabel}
        <span class="ed-kicker-badge">{primaryTypeLabel}</span>
      {/if}
    {/snippet}

    {#snippet actions()}
      {#if isOwner && formRef}
        <button
          class="btn btn-outline btn-sm"
          onclick={handleEditInFormClick}
          aria-label={m.amb_resource_edit_in_form()}
        >
          <EditIcon class="h-4 w-4" />
          {m.amb_resource_edit_in_form()}
        </button>
      {/if}
    {/snippet}
  </DetailHeader>

  <!-- HERO — editorial banner: script-accented title + key facts + cover. -->
  <section class="ed-hero" class:no-cover={false}>
    <div class="ed-hero-grid">
      <div class="ed-cover-card" class:ed-cover-framed={!!resource.image}>
        <ResourceCover {resource} size="full" aspect="portrait" />
      </div>

      <div class="ed-hero-body">
        <h1 class="ed-hero-title {titleSizeClass}" lang={resource.languages?.[0] ?? getLocale()}>
          {titleParts.main}{#if titleParts.script}<span class="script">{titleParts.script}</span
            >{/if}{#if titleParts.tail}
            {titleParts.tail}{/if}
        </h1>

        {#if heroFacts.length > 0}
          <ul class="ed-hero-key">
            {#each heroFacts as fact (fact.key)}
              {@const Ic = heroIcon(fact.icon)}
              <li>
                <span class="ic"><Ic class_="w-6 h-6" /></span>
                <div>
                  <span class="lbl">{fact.label}</span>
                  {#if fact.refs}
                    <span class="val val-refs">
                      {#each fact.refs as ref, i (ref.text + '|' + i)}
                        {#if ref.href}
                          <a
                            class="val-link"
                            href={ref.href}
                            target="_blank"
                            rel="noopener noreferrer">{ref.text}</a
                          >
                        {:else}
                          <span>{ref.text}</span>
                        {/if}
                      {/each}
                    </span>
                  {:else if fact.href}
                    <a
                      class="val val-link"
                      href={fact.href}
                      target="_blank"
                      rel="noopener noreferrer">{fact.value}</a
                    >
                  {:else}
                    <span class="val">{fact.value}</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  </section>

  <!-- ACCESS BAND — only when the resource itself is an external URL (d-tag). -->
  {#if hasIdentifierUrl}
    <section class="ed-band">
      <div class="ed-band-inner">
        <span class="icn"><ExternalLinkIcon class_="w-12 h-12" /></span>
        <div class="ed-band-text">
          <h2>{m.amb_resource_access_content_title()}</h2>
          <p>{m.amb_resource_access_content_external_desc()}</p>
          <code class="ed-band-url">{resource.identifier}</code>
        </div>
        <button onclick={navigateToContent} class="ed-cta">
          <ExternalLinkIcon class_="w-4 h-4" />
          {m.amb_resource_open_content()}
        </button>
      </div>
    </section>
  {/if}

  <!-- DESCRIPTION (lede) -->
  {#if resource.description}
    <section class="ed-panel ed-lede">
      <MarkdownRenderer content={resource.description} class="prose max-w-none" />
    </section>
  {/if}

  <!-- METADATA — unified olive card grid: core educational facts + extension facets -->
  {#if metadataCards.length > 0}
    <section class="ed-sect">
      <h2 class="ed-sect-head">{m.amb_resource_educational_details()}</h2>
      <MetadataCardGrid cards={metadataCards} />
    </section>
  {/if}

  <!-- TAGS + LICENSE — side-by-side panels -->
  {#if resource.keywords.length > 0 || resource.license}
    <section class="ed-tagslicense">
      {#if resource.keywords.length > 0}
        <div class="ed-panel">
          <h3 class="ed-panel-head">
            <TagIcon class_="w-4 h-4" />
            {m.amb_resource_topics_keywords()}
          </h3>
          <EventTags tags={resource.keywords} size="md" targetRoute="/discover" />
        </div>
      {/if}

      {#if resource.license}
        <div class="ed-license-card">
          <span class="pill"><CheckIcon class_="w-4 h-4" /> {resource.license.label}</span>
          <h3 class="ed-panel-head">{m.amb_resource_license()}</h3>
          <!-- eslint-disable svelte/no-navigation-without-resolve -- external: license URL -->
          <a
            href={resource.license.id}
            target="_blank"
            rel="noopener noreferrer"
            class="ed-license-link"
          >
            {m.amb_resource_view_license()}
          </a>
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
        </div>
      {/if}
    </section>
  {/if}

  <!-- ALL CONTRIBUTORS LIST -->
  {#if creators.length > 1 || resource.creatorNames.length > 1}
    <section class="ed-sect-plain">
      <h3 class="ed-block-head">{m.amb_resource_all_contributors()}</h3>
      {#snippet initialAvatar(/** @type {string} */ name)}
        <div class="av av-fallback" aria-hidden="true">
          {(name?.trim()?.charAt(0) || '?').toUpperCase()}
        </div>
      {/snippet}
      <div class="ed-contrib-grid">
        {#each creators as creator (creator.pubkey)}
          {@const getCreatorProfile = useUserProfile(creator.pubkey)}
          {@const creatorProfile = getCreatorProfile()}
          {@const picture = getProfilePicture(creatorProfile)}
          {@const name = getDisplayName(creatorProfile, creator.pubkey.slice(0, 8) + '...')}
          <div class="ed-contrib">
            {#if picture}
              <img class="av" src={picture} alt={m.amb_resource_creator_alt()} />
            {:else}
              {@render initialAvatar(name)}
            {/if}
            <span class="name">{name}</span>
          </div>
        {/each}

        {#each resource.creatorNames as name (name)}
          <div class="ed-contrib">
            {@render initialAvatar(name)}
            <span class="name">{name}</span>
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- RELATED RESOURCES -->
  {#if relatedResources.length > 0}
    <section class="ed-sect-plain">
      <h3 class="ed-block-head">{m.amb_resource_related_resources()}</h3>
      <div class="ed-related-list">
        {#each relatedResources as related (related.naddr)}
          <a href={resolve(`/${related.naddr}`)} class="ed-related">
            <ArrowLeftRightIcon class_="ed-related-ico" />
            <span class="name">{related.label}</span>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <!-- UPLOADED FILES - Promoted for Nostr-native content -->
  {#if resource.encodings && resource.encodings.length > 0}
    <section class="ed-sect-plain {isNostrNativeOnly ? 'ed-files-native' : ''}">
      <h3 class="ed-block-head">
        {#if isNostrNativeOnly}
          <FilesIcon class_="ed-block-ico" />
          {m.amb_resource_access_content_title()}
        {:else}
          <FilesIcon class_="ed-block-ico" />
          {m.amb_resource_uploaded_files()}
        {/if}
      </h3>
      {#if isNostrNativeOnly}
        <p class="ed-files-note">{m.amb_resource_nostr_native_description()}</p>
      {/if}
      <div class="ed-file-list">
        {#each resource.encodings as file (file.url)}
          <div class="ed-file">
            <span class="ed-file-emoji">{getFileIcon(file.mimeType)}</span>
            <div class="ed-file-meta">
              <div class="name">{file.name}</div>
              <div class="sub">
                <span>{file.mimeType} • {formatFileSize(file.size)}</span>
                {#if file.sha256}
                  <EncodingRowBadge sha256={file.sha256} />
                {/if}
              </div>
            </div>
            <!-- eslint-disable svelte/no-navigation-without-resolve -- external: uploaded file URLs -->
            <a href={file.url} target="_blank" rel="noopener noreferrer" class="ed-file-btn">
              <GlobeIcon class_="ed-file-btn-ico" />
              {m.amb_resource_view_file()}
            </a>
            <a href={file.url} download class="ed-file-btn">
              <FilesIcon class_="ed-file-btn-ico" />
              {m.amb_resource_download_file()}
            </a>
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
          </div>
          <EncodingPreview url={file.url} mimeType={file.mimeType} name={file.name} />
        {/each}
      </div>
    </section>
  {/if}

  <!-- EXTERNAL REFERENCES (r-tags) - Additional reference URLs -->
  {#if hasExternalRefs}
    <section class="ed-sect-plain">
      <h3 class="ed-block-head">
        <ExternalLinkIcon class_="ed-block-ico" />
        {resource.externalUrls.length > 1
          ? m.amb_resource_external_references()
          : m.amb_resource_external_reference()}
      </h3>
      <div class="ed-ref-list">
        {#each resource.externalUrls as url (url)}
          <div class="ed-ref">
            <LinkIcon class_="ed-ref-ico" />
            <!-- eslint-disable svelte/no-navigation-without-resolve -- external: reference URL -->
            <a href={url} target="_blank" rel="noopener noreferrer" class="ed-ref-link">{url}</a>
            <!-- eslint-enable svelte/no-navigation-without-resolve -->
            <ExternalLinkIcon class_="ed-ref-out" />
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- REACTIONS (Nostr-first: Primary interaction) -->
  <div class="ed-reactions">
    <ReactionBar {event} />
    <BookmarkButton {event} />
  </div>

  <!-- COMMENTS SECTION (Nostr-first: Primary interaction) -->
  <section class="ed-sect-plain">
    <h2 class="ed-block-head">{m.amb_resource_discussion()}</h2>
    <CommentList rootEvent={event} {activeUser} />
  </section>
</article>

<DeleteConfirmModal
  open={showDeleteConfirmation}
  title={m.common_delete() + '?'}
  itemName={resource.name}
  {isDeleting}
  onconfirm={handleDeleteResource}
  oncancel={() => (showDeleteConfirmation = false)}
/>

<style>
  /* ── Editorial detail view ─────────────────────────────────────────────
     Light mode uses a fixed editorial palette that matches the magazine
     mockup. Dark themes (any data-theme ending in "dark") degrade to the
     app's DaisyUI tokens so the page stays legible. Fonts (Outfit display +
     Caveat script) are self-hosted via @fontsource-variable, scoped here. */
  .amb-detail {
    --c-hero: oklch(56% 0.06 195);
    --c-hero-2: oklch(48% 0.06 195);
    --c-band: oklch(50% 0.12 5);
    --c-olive: oklch(60% 0.1 105);
    --c-olive-2: oklch(52% 0.1 105);
    --c-bg: oklch(92% 0.018 80);
    --c-paper: oklch(98% 0.008 80);
    --c-ink: oklch(20% 0.02 80);
    --c-ink-soft: oklch(38% 0.02 80);
    --c-cta: oklch(74% 0.16 60);
    --c-cta-ink: oklch(20% 0.02 80);
    --c-rule: oklch(82% 0.02 80);
    --c-on-dark: oklch(96% 0.01 80);

    --ed-display: 'Outfit Variable', 'Outfit', ui-sans-serif, system-ui, sans-serif;
    --ed-script: 'Caveat Variable', 'Caveat', ui-serif, cursive;

    color: var(--c-ink);
  }

  /* Dark-mode degrade — map editorial vars onto theme tokens. */
  :global([data-theme$='dark']) .amb-detail {
    --c-hero: var(--color-base-300);
    --c-hero-2: var(--color-base-200);
    --c-band: var(--color-primary);
    --c-olive: var(--color-base-200);
    --c-olive-2: var(--color-secondary);
    --c-bg: var(--color-base-200);
    --c-paper: var(--color-base-100);
    --c-ink: var(--color-base-content);
    --c-ink-soft: color-mix(in oklch, var(--color-base-content) 65%, transparent);
    --c-cta: var(--color-accent);
    --c-cta-ink: var(--color-accent-content);
    --c-rule: color-mix(in oklch, var(--color-base-content) 16%, transparent);
    --c-on-dark: var(--color-base-content);
  }

  /* Kicker badge in the toolbar (replaces page title there). */
  .ed-kicker-badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 11px;
    border-radius: 999px;
    background: var(--c-olive);
    color: var(--c-on-dark);
    font-family: var(--ed-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  /* ── HERO ─────────────────────────────────────────────────────────── */
  .ed-hero {
    background: linear-gradient(165deg, var(--c-hero) 0%, var(--c-hero-2) 100%);
    color: var(--c-on-dark);
    border-radius: 22px;
    padding: clamp(28px, 5vw, 56px);
    margin: 18px 0 28px;
  }
  .ed-hero-grid {
    display: grid;
    grid-template-columns: minmax(180px, 300px) 1fr;
    gap: clamp(24px, 5vw, 56px);
    align-items: start;
  }
  @media (max-width: 720px) {
    .ed-hero-grid {
      grid-template-columns: 1fr;
      gap: 24px;
    }
  }
  /* Bare wrapper by default — the typographic cover renders its own white
     frame, so wrapping it again would produce a visible double border. */
  .ed-cover-card {
    border-radius: 22px;
  }
  /* Real image thumbnails have no frame of their own, so they get one here. */
  .ed-cover-framed {
    background: #fff;
    padding: 12px;
    box-shadow:
      0 30px 60px -28px rgba(0, 0, 0, 0.5),
      0 10px 22px -12px rgba(0, 0, 0, 0.3);
  }
  .ed-cover-card :global(img),
  .ed-cover-card :global(.resource-cover),
  .ed-cover-card :global(canvas) {
    border-radius: 12px;
    overflow: hidden;
  }
  .ed-hero-body {
    min-width: 0;
  }
  .ed-hero-title {
    font-family: var(--ed-display);
    font-weight: 800;
    font-size: clamp(36px, 5.5vw, 84px);
    line-height: 0.95;
    letter-spacing: -0.02em;
    margin: 0;
    text-wrap: balance;
    /* Long German compounds wrap inside the hero rather than bleeding past the
       band. hyphens:auto (with the h1's lang) breaks at syllables with a visible
       hyphen; overflow-wrap is only a last resort for un-hyphenatable tokens.
       No word-break — that breaks mid-word at arbitrary characters. */
    overflow-wrap: break-word;
    hyphens: auto;
  }
  /* Length-tiered sizing: longer titles shrink so they fit with fewer breaks. */
  .ed-hero-title.is-long {
    font-size: clamp(32px, 4vw, 60px);
  }
  .ed-hero-title.is-xlong {
    font-size: clamp(28px, 3vw, 46px);
  }
  .ed-hero-title .script {
    font-family: var(--ed-script);
    font-weight: 700;
    font-style: italic;
    letter-spacing: 0;
    font-size: 0.82em;
    line-height: 0.9;
    display: block;
    color: var(--c-on-dark);
    transform: translateX(8px) rotate(-2deg);
  }
  .ed-hero-key {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin: 32px 0 0;
    padding: 0;
  }
  .ed-hero-key li {
    display: flex;
    gap: 16px;
    align-items: center;
    list-style: none;
  }
  .ed-hero-key .ic {
    flex-shrink: 0;
    display: grid;
    place-items: center;
    opacity: 0.95;
  }
  .ed-hero-key .lbl {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    opacity: 0.7;
    display: block;
    margin-bottom: 2px;
  }
  .ed-hero-key .val {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.005em;
    display: block;
  }
  .ed-hero-key .val-refs {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ed-hero-key .val-link {
    text-decoration: underline;
    text-underline-offset: 3px;
    text-decoration-thickness: 1px;
    text-decoration-color: color-mix(in oklch, currentColor 45%, transparent);
    transition: text-decoration-color 0.15s ease;
  }
  .ed-hero-key .val-refs .val-link {
    width: fit-content;
  }
  .ed-hero-key .val-link:hover {
    text-decoration-color: currentColor;
  }

  /* ── ACCESS BAND ──────────────────────────────────────────────────── */
  .ed-band {
    background: var(--c-band);
    color: var(--c-on-dark);
    border-radius: 18px;
    padding: clamp(24px, 4vw, 40px);
    margin-bottom: 28px;
  }
  .ed-band-inner {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: clamp(16px, 3vw, 36px);
    align-items: center;
  }
  @media (max-width: 640px) {
    .ed-band-inner {
      grid-template-columns: 1fr;
      text-align: center;
      justify-items: center;
    }
  }
  .ed-band .icn {
    display: grid;
    place-items: center;
    opacity: 0.95;
  }
  .ed-band-text h2 {
    font-size: clamp(20px, 2.3vw, 28px);
    font-weight: 700;
    margin: 0 0 8px;
    letter-spacing: -0.01em;
  }
  .ed-band-text p {
    margin: 0 0 8px;
    font-size: 15px;
    line-height: 1.55;
    opacity: 0.92;
    max-width: 520px;
  }
  .ed-band-url {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    background: rgba(255, 255, 255, 0.16);
    padding: 4px 8px;
    border-radius: 6px;
    color: var(--c-on-dark);
    word-break: break-all;
  }
  .ed-cta {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    background: var(--c-cta);
    color: var(--c-cta-ink);
    font-family: var(--ed-display);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-size: 14px;
    padding: 14px 24px;
    border: 0;
    border-radius: 8px;
    cursor: pointer;
    white-space: nowrap;
    box-shadow: 0 12px 24px -10px rgba(0, 0, 0, 0.35);
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease;
  }
  .ed-cta:hover {
    transform: translateY(-1px);
    box-shadow: 0 16px 32px -12px rgba(0, 0, 0, 0.4);
  }

  /* ── PANELS / LEDE ────────────────────────────────────────────────── */
  .ed-panel {
    background: var(--c-paper);
    border-radius: 18px;
    padding: 26px 28px;
    border: 1px solid var(--c-rule);
  }
  .ed-lede {
    margin-bottom: 28px;
    font-size: 17px;
    line-height: 1.65;
  }
  .ed-panel-head {
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--c-ink-soft);
    margin: 0 0 14px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  /* ── SECTION HEADINGS ─────────────────────────────────────────────── */
  .ed-sect {
    margin-bottom: 28px;
  }
  .ed-sect-head {
    font-family: var(--ed-display);
    font-weight: 800;
    font-size: clamp(28px, 4vw, 48px);
    color: var(--c-olive-2);
    margin: 0 0 18px;
    letter-spacing: -0.015em;
  }
  .ed-sect-plain {
    margin-bottom: 28px;
  }
  .ed-block-head {
    font-family: var(--ed-display);
    font-weight: 700;
    font-size: 20px;
    color: var(--c-ink);
    margin: 0 0 14px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ed-block-head :global(.ed-block-ico) {
    width: 1.25rem;
    height: 1.25rem;
    color: var(--c-olive-2);
  }

  /* ── TAGS + LICENSE ───────────────────────────────────────────────── */
  .ed-tagslicense {
    display: grid;
    grid-template-columns: 1fr;
    gap: 18px;
    margin-bottom: 28px;
  }
  @media (min-width: 720px) {
    .ed-tagslicense {
      grid-template-columns: 1.6fr 1fr;
    }
  }
  .ed-license-card {
    background: linear-gradient(180deg, var(--c-paper), oklch(95% 0.02 195));
    border: 1px solid oklch(80% 0.04 195);
    border-radius: 18px;
    padding: 26px 28px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  :global([data-theme$='dark']) .amb-detail .ed-license-card {
    background: var(--c-paper);
    border-color: var(--c-rule);
  }
  .ed-license-card .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    background: oklch(75% 0.13 195);
    color: #fff;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .ed-license-link {
    font-size: 14px;
    color: oklch(45% 0.12 195);
    text-decoration: none;
    font-weight: 600;
  }
  :global([data-theme$='dark']) .amb-detail .ed-license-link {
    color: var(--color-primary);
  }
  .ed-license-link:hover {
    text-decoration: underline;
  }

  /* ── CONTRIBUTORS ─────────────────────────────────────────────────── */
  .ed-contrib-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .ed-contrib {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--c-paper);
    border: 1px solid var(--c-rule);
    border-radius: 999px;
    padding: 6px 14px 6px 6px;
  }
  .ed-contrib .av {
    width: 32px;
    height: 32px;
    border-radius: 999px;
    object-fit: cover;
    background: var(--c-bg);
  }
  .ed-contrib .av-fallback {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 700;
    color: var(--c-ink);
  }
  .ed-contrib .name {
    font-size: 14px;
    font-weight: 600;
    color: var(--c-ink);
  }

  /* ── RELATED ──────────────────────────────────────────────────────── */
  .ed-related-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ed-related {
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--c-paper);
    border: 1px solid var(--c-rule);
    border-radius: 14px;
    padding: 14px 18px;
    text-decoration: none;
    transition: background 0.15s ease;
  }
  .ed-related:hover {
    background: var(--c-bg);
  }
  .ed-related :global(.ed-related-ico) {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    color: var(--c-olive-2);
  }
  .ed-related .name {
    font-weight: 600;
    color: var(--c-ink);
  }

  /* ── FILES ────────────────────────────────────────────────────────── */
  .ed-files-native {
    border: 2px solid var(--c-olive-2);
    border-radius: 18px;
    padding: clamp(20px, 3vw, 28px);
    background: color-mix(in oklch, var(--c-olive) 14%, transparent);
  }
  .ed-files-note {
    font-size: 14px;
    color: var(--c-ink-soft);
    margin: 0 0 16px;
  }
  .ed-file-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ed-file {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 16px;
    background: var(--c-paper);
    border: 1px solid var(--c-rule);
    border-radius: 14px;
  }
  .ed-file-emoji {
    font-size: 1.6rem;
    line-height: 1;
  }
  .ed-file-meta {
    min-width: 0;
    flex: 1;
  }
  .ed-file-meta .name {
    font-weight: 600;
    font-size: 15px;
    color: var(--c-ink);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ed-file-meta .sub {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--c-ink-soft);
    font-family: ui-monospace, monospace;
    margin-top: 2px;
  }
  .ed-file-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--c-rule);
    background: transparent;
    color: var(--c-ink);
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 600;
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.15s ease;
  }
  .ed-file-btn:hover {
    background: var(--c-bg);
  }
  .ed-file-btn :global(.ed-file-btn-ico) {
    width: 1rem;
    height: 1rem;
  }

  /* ── EXTERNAL REFERENCES ──────────────────────────────────────────── */
  .ed-ref-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ed-ref {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    background: var(--c-paper);
    border: 1px solid var(--c-rule);
    border-radius: 14px;
  }
  .ed-ref :global(.ed-ref-ico) {
    width: 1.25rem;
    height: 1.25rem;
    flex-shrink: 0;
    color: var(--c-ink-soft);
  }
  .ed-ref-link {
    flex: 1;
    min-width: 0;
    color: var(--c-olive-2);
    font-weight: 500;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ed-ref-link:hover {
    text-decoration: underline;
  }
  .ed-ref :global(.ed-ref-out) {
    width: 1rem;
    height: 1rem;
    flex-shrink: 0;
    color: var(--c-ink-soft);
    opacity: 0.6;
  }

  /* ── REACTIONS ────────────────────────────────────────────────────── */
  .ed-reactions {
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--c-rule);
    border-bottom: 1px solid var(--c-rule);
    padding: 16px 0;
    margin-bottom: 28px;
  }
</style>
