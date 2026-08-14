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
  import { contentSectionLabel } from '$lib/helpers/content-section-label.js';
  import { withSectionAccess } from '$lib/groups/section-access.js';
  import { communityUpdateTemplate } from '$lib/groups/community-flips.js';
  import { publishCommunityUpdate } from '$lib/helpers/publishCommunityUpdate.js';
  import { showToast } from '$lib/helpers/toast';
  import { unique, uniqueBy } from '$lib/helpers/unique.js';
  import { untrack } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   communikeyEvent: {tags?: string[][], content?: string, created_at?: number} | null | undefined,
   *   communitySigner: any,
   *   roleSuggestions?: string[]
   * }}
   */
  let { communikeyEvent, communitySigner, roleSuggestions = [] } = $props();

  // A malformed 10222 can repeat a `content` tag name — parseCommunityContentTypes
  // yields one ContentTypeConfig per tag, so dedupe by name before it feeds the
  // keyed {#each} below (see CLAUDE.md's "Keyed {#each} over Tag-Derived Data
  // Must Be Deduped"): a duplicate key otherwise crashes the whole settings page.
  const sections = $derived(uniqueBy(parseCommunityContentTypes(communikeyEvent), (s) => s.name));

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

  // Last-synced value per section — NOT the same as "the freshly parsed
  // section", which would make dirtiness undecidable: a row the user never
  // touched must still pick up an external/other-row update, while a row
  // the user DID edit must survive one. So dirty = draft diverged from what
  // WE last saw published, not from whatever the event says right now.
  // Plain (non-$state) internal ref, mutated only inside the effect below —
  // never read by the template (see CLAUDE.md's plain-let-for-internal-refs
  // rule).
  /** @type {Record<string, Draft>} */
  let baselines = {};

  // Refresh drafts whenever the underlying sections change (new community
  // event, or ANY save — including a different row's own save, since
  // publishCommunityUpdate does eventStore.add synchronously and re-derives
  // this prop) — but only for rows the user hasn't touched since the last
  // sync. A row that WAS dirty naturally becomes clean again once its own
  // save round-trips (its draft then equals the new baseline). `drafts` is
  // read via untrack() so this effect only depends on `sections`, never on
  // the state it writes (see CLAUDE.md's $state-inside-$effect gotcha —
  // reading+writing the same $state here would re-trigger itself).
  $effect(() => {
    const currentSections = sections;
    const previousDrafts = untrack(() => drafts);
    /** @type {Record<string, Draft>} */
    const nextDrafts = {};
    /** @type {Record<string, Draft>} */
    const nextBaselines = {};
    for (const section of currentSections) {
      const access = section.access ?? { tier: 'all' };
      const fresh = {
        tier: access.tier,
        role: access.tier === 'role' ? (access.role ?? '') : ''
      };
      const priorDraft = previousDrafts[section.name];
      const priorBaseline = baselines[section.name];
      // Compare role trimmed: saveSection() trims before publishing, so the
      // baseline's role is always trimmed, but the draft can carry
      // whitespace the user hasn't cleaned up yet (mid-typing, or leftover
      // after a save round-trip). Comparing untrimmed would flag a row
      // dirty forever on a save that changed nothing but surrounding
      // whitespace — the draft never converges back to `fresh`.
      const isDirty =
        priorDraft &&
        priorBaseline &&
        (priorDraft.tier !== priorBaseline.tier ||
          priorDraft.role.trim() !== priorBaseline.role.trim());
      nextDrafts[section.name] = isDirty ? /** @type {Draft} */ (priorDraft) : fresh;
      nextBaselines[section.name] = fresh;
    }
    baselines = nextBaselines;
    drafts = nextDrafts;
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

  /**
   * A 'role' tier with a blank role would make withSectionAccess emit no
   * access tag at all — i.e. silently downgrade the section to publicly
   * open. Never let that reach saveSection/publish; the save button is
   * disabled on this too (see template) so this is defense-in-depth.
   * @param {Draft | undefined} draft
   */
  function isRoleMissing(draft) {
    return !!draft && draft.tier === 'role' && !draft.role.trim();
  }

  /** @param {import('$lib/helpers/communityRelays.js').ContentTypeConfig} section */
  async function saveSection(section) {
    if (!communitySigner || !communikeyEvent || savingSection[section.name]) return;
    const draft = drafts[section.name];
    if (!draft || isRoleMissing(draft)) return;

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
        {@const roleMissing = isRoleMissing(draft)}
        <div
          class="flex flex-wrap items-center gap-3 py-3"
          data-testid="access-tier-row-{slug(section.name)}"
        >
          <span class="flex-1 truncate text-sm font-semibold"
            >{contentSectionLabel(section.name)}</span
          >

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
              disabled={!!savingSection[section.name] || roleMissing}
              onclick={() => saveSection(section)}
            >
              {#if savingSection[section.name]}
                <span class="loading loading-xs loading-spinner"></span>
              {/if}
              {m.community_access_editor_save()}
            </button>

            {#if roleMissing}
              <p
                class="w-full text-xs text-error"
                data-testid="access-tier-role-required-{slug(section.name)}"
              >
                {m.community_access_editor_role_required()}
              </p>
            {/if}
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
