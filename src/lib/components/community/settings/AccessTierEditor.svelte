<!--
  AccessTierEditor — Task 7. Per-section access tier editor for moderated
  communities: one row per `content` section (parseCommunityContentTypes),
  a tier select (alle/nur Mitglieder/Rolle) and — for the role tier — a text
  input with a roleSuggestions datalist. Saving a row is a SURGICAL edit of
  just that section's `access` tag via withSectionAccess +
  communityUpdateTemplate (Tasks 2+3); sibling sections and pointer tags
  pass through untouched, so concurrent per-row saves never clobber each
  other's edits.

  Rendered by SettingsView only for moderated + owner (see there); this
  component itself does not re-check ownership.
-->
<script>
  import { parseCommunityContentTypes } from '$lib/helpers/communityRelays.js';
  import { withSectionAccess } from '$lib/groups/section-access.js';
  import { communityUpdateTemplate } from '$lib/groups/community-flips.js';
  import { publishCommunityUpdate } from '$lib/helpers/publishCommunityUpdate.js';
  import { showToast } from '$lib/helpers/toast';
  import { unique } from '$lib/helpers/unique.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   communikeyEvent: {tags?: string[][], content?: string, created_at?: number} | null | undefined,
   *   communitySigner: any,
   *   roleSuggestions?: string[]
   * }}
   */
  let { communikeyEvent, communitySigner, roleSuggestions = [] } = $props();

  const sections = $derived(parseCommunityContentTypes(communikeyEvent));

  // roleSuggestions is caller-supplied (Task 8: union of roster roles) —
  // dedupe defensively before it feeds the keyed datalist {#each} below (see
  // CLAUDE.md's "Keyed {#each} over Tag-Derived Data Must Be Deduped").
  const suggestedRoles = $derived(unique(roleSuggestions));

  /**
   * data-testid values must be whitespace-free, stable CSS-selector-safe
   * tokens — section names are free-form user input (a community owner can
   * name a section anything), so we slug them rather than trusting them
   * verbatim in an attribute a test/selector will match against.
   * @param {string} name
   */
  function slug(name) {
    return (name ?? '').trim().replace(/[^a-zA-Z0-9_-]+/g, '-');
  }

  /** @typedef {{tier: 'all'|'members'|'role', role: string}} Draft */

  /** Per-section editable state, keyed by section name (not the slug). @type {Record<string, Draft>} */
  let drafts = $state({});

  // Reset drafts whenever the underlying sections change (new community
  // event, or a save round-trips through EventStore and the prop updates).
  // Only `sections` is read here — `drafts` is written, never read, so this
  // can't re-trigger itself (see CLAUDE.md's $state-inside-$effect gotcha).
  $effect(() => {
    /** @type {Record<string, Draft>} */
    const next = {};
    for (const section of sections) {
      const access = section.access ?? { tier: 'all' };
      next[section.name] = {
        tier: access.tier,
        role: access.tier === 'role' ? (access.role ?? '') : ''
      };
    }
    drafts = next;
  });

  /** Section names currently publishing, so only that row's button disables. @type {Record<string, boolean>} */
  let savingSection = $state({});

  /** @param {string} sectionName @param {string} tier */
  function setTier(sectionName, tier) {
    const draft = drafts[sectionName];
    if (!draft) return;
    // The <select> only ever offers these three values — cast past the
    // widened `string` from the DOM event.
    const nextTier = /** @type {Draft['tier']} */ (tier);
    drafts = { ...drafts, [sectionName]: { ...draft, tier: nextTier } };
  }

  /** @param {string} sectionName @param {string} role */
  function setRole(sectionName, role) {
    const draft = drafts[sectionName];
    if (!draft) return;
    drafts = { ...drafts, [sectionName]: { ...draft, role } };
  }

  /** @param {import('$lib/helpers/communityRelays.js').ContentTypeConfig} section */
  async function saveSection(section) {
    if (!communitySigner || !communikeyEvent || savingSection[section.name]) return;
    const draft = drafts[section.name];
    if (!draft) return;

    /** @type {import('$lib/groups/section-access.js').AccessTier} */
    const access =
      draft.tier === 'role' ? { tier: 'role', role: draft.role.trim() } : { tier: draft.tier };

    savingSection = { ...savingSection, [section.name]: true };
    try {
      const template = communityUpdateTemplate(
        communikeyEvent,
        withSectionAccess(communikeyEvent.tags ?? [], section.name, access)
      );
      await publishCommunityUpdate(template, communitySigner);
      showToast(m.community_access_editor_saved(), 'success');
    } catch (error) {
      console.error('settings: access tier save failed', error);
      showToast(
        m.community_access_editor_save_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      savingSection = { ...savingSection, [section.name]: false };
    }
  }
</script>

<div class="card mb-6 bg-base-100 shadow-xl" data-testid="access-tier-editor">
  <div class="card-body">
    <h2 class="card-title">{m.community_access_editor_title()}</h2>
    <p class="text-sm text-base-content/70">{m.community_access_editor_lead()}</p>

    <div class="divide-y divide-base-300">
      {#each sections as section (section.name)}
        {@const draft = drafts[section.name]}
        <div
          class="flex flex-wrap items-center gap-3 py-3"
          data-testid="access-tier-row-{slug(section.name)}"
        >
          <span class="flex-1 truncate text-sm font-semibold">{section.name}</span>

          {#if draft}
            <select
              class="select-bordered select select-sm"
              aria-label={section.name}
              value={draft.tier}
              onchange={(e) =>
                setTier(section.name, /** @type {HTMLSelectElement} */ (e.target).value)}
            >
              <option value="all">{m.community_access_all()}</option>
              <option value="members">{m.community_access_members()}</option>
              <option value="role">{m.community_access_role()}</option>
            </select>

            {#if draft.tier === 'role'}
              <input
                type="text"
                class="input-bordered input input-sm"
                list="access-tier-role-suggestions-{slug(section.name)}"
                placeholder={m.community_access_editor_role_placeholder()}
                value={draft.role}
                oninput={(e) =>
                  setRole(section.name, /** @type {HTMLInputElement} */ (e.target).value)}
              />
              <datalist id="access-tier-role-suggestions-{slug(section.name)}">
                {#each suggestedRoles as role (role)}
                  <option value={role}></option>
                {/each}
              </datalist>
            {/if}

            <button
              class="btn btn-sm btn-primary"
              data-testid="access-tier-save-{slug(section.name)}"
              disabled={!!savingSection[section.name]}
              onclick={() => saveSection(section)}
            >
              {#if savingSection[section.name]}
                <span class="loading loading-xs loading-spinner"></span>
              {/if}
              {m.community_access_editor_save()}
            </button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
