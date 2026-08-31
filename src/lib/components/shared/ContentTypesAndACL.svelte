<!--
  Content type chips for the create/edit community modals.

  This component used to also carry the per-section form-ACL editor
  ("Bewerbungsformulare": default form picker + per-type overrides). That
  authoring surface was removed with the community-type redesign (laoc,
  2026-08-17): access is now a property of the TYPE — Moderiert gates
  joining (membership application + section tiers), Privat gates everything
  (invites + publisher window) — and a per-section application system inside
  an Offen community was a fourth, hidden hybrid duplicating the approval
  machinery. The READ side of legacy form-gated sections (AccessGateBanner,
  gate badges, formRef round-tripping on save) is untouched.
-->

<script>
  import * as m from '$lib/paraglide/messages';

  /**
   * @typedef {Object} ContentTypeConfig
   * @property {string} name
   * @property {boolean} enabled
   * @property {{read: string|null, write: string|null}} badges
   * @property {string[]} relays
   * @property {string} formRef
   */

  /**
   * @type {{
   *   contentTypes: Record<string, ContentTypeConfig>,
   *   errors?: Record<string, string>
   * }}
   */
  let { contentTypes = $bindable(), errors = {} } = $props();

  /** Content type display names from i18n
   * @type {Record<string, () => string>}
   */
  const contentTypeLabels = {
    calendar: () => m.create_community_modal_content_calendar(),
    chat: () => m.create_community_modal_content_chat(),
    articles: () => m.create_community_modal_content_articles(),
    posts: () => m.create_community_modal_content_posts(),
    wikis: () => m.create_community_modal_content_wikis(),
    learning: () => m.create_community_modal_content_learning(),
    polls: () => m.create_community_modal_content_polls(),
    bookmarks: () => m.create_community_modal_content_bookmarks(),
    meet: () => m.create_community_modal_content_meet()
  };
</script>

<!-- Content Type Chips -->
<div class="form-control">
  <div class="label">
    <span class="label-text font-semibold">{m.create_community_modal_content_types_label()}</span>
    <span class="label-text-alt text-sm">{m.create_community_modal_content_types_alt()}</span>
  </div>
  <div class="flex flex-wrap gap-2">
    {#each Object.entries(contentTypes) as [key, ct] (key)}
      <button
        type="button"
        class="btn rounded-full btn-sm {ct.enabled
          ? 'btn-primary'
          : 'opacity-60 btn-ghost btn-outline'}"
        onclick={() => (contentTypes[key].enabled = !contentTypes[key].enabled)}
      >
        {#if ct.enabled}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            class="h-4 w-4"
          >
            <path
              fill-rule="evenodd"
              d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z"
              clip-rule="evenodd"
            />
          </svg>
        {/if}
        {contentTypeLabels[key]?.() || ct.name}
      </button>
    {/each}
  </div>
  {#if errors.contentTypes}
    <div class="label">
      <span class="label-text-alt text-error">{errors.contentTypes}</span>
    </div>
  {/if}
</div>
