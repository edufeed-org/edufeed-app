<!--
  SectionOverridePane — "Inhalte & Rechte" for root-group ADMINS.

  The owner edits content sections on the kind 10222 (CommunityBasicsForm +
  AccessTierEditor), which only the community keypair can sign. Admins run the
  community but hold no such key, so they publish a kind-30223 override
  instead (src/lib/groups/section-override.js). Same choices, different event.

  Two differences from AccessTierEditor, both following from the data model:
  the override carries the WHOLE section block, so this is one save rather
  than per-row surgical edits; and because it carries the whole block, the
  content-type chips belong here too — an admin can add and remove content
  types, not just re-tier the ones the owner happened to declare.

  Rendered by SettingsView only for a moderated community whose viewer is a
  root-group admin and NOT the owner; this component does not re-check that.
-->
<script>
  import ContentTypesAndACL from '$lib/components/shared/ContentTypesAndACL.svelte';
  import { contentSectionLabel } from '$lib/helpers/content-section-label.js';
  import {
    contentTypesFromEvent,
    sectionsFromContentTypes
  } from '$lib/helpers/communityTagBuilder.js';
  import { publishSectionOverride } from '$lib/helpers/publishSectionOverride.js';
  import { PUBLISHER_ROLE } from '$lib/groups/roles.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useUserProfile } from '$lib/stores/user-profile.svelte.js';
  import { getUserDisplayName } from '$lib/helpers/message-utils.js';
  import { showToast } from '$lib/helpers/toast';
  import { unique } from '$lib/helpers/unique.js';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   communikeyEvent: any,
   *   roleSuggestions?: string[],
   *   overrideAuthor?: string | null
   * }}
   */
  let { communikeyEvent, roleSuggestions = [], overrideAuthor = null } = $props();

  const getActiveUser = useActiveUser();
  const getAuthorProfile = useUserProfile(() => overrideAuthor ?? undefined);

  const suggestedRoles = $derived(unique([...roleSuggestions, PUBLISHER_ROLE]));

  /** @type {Record<string, any>} */
  let contentTypes = $state(contentTypesFromEvent(null));

  // 'publisher' is a UI-level tier over an ordinary ["access","role",
  // "publisher"] gate, so it cannot be re-derived from the access value: with
  // the role already set to `publisher`, picking "Rolle" would map straight
  // back to "Nur Publisher" and the free-text box would never appear. Hold
  // the choice explicitly instead, as AccessTierEditor's Draft does.
  /** @type {Record<string, 'all'|'members'|'publisher'|'role'>} */
  let tierChoices = $state({});

  /** Which 10222/override the draft was seeded from — plain ref, never read
   * by the template, so re-seeding cannot re-trigger its own effect. */
  let seededFrom = '';

  // Re-seed only when a genuinely different event arrives (the owner edited
  // the 10222, or another admin's override won). Re-seeding on every derive
  // would wipe the chips the user is in the middle of toggling.
  $effect(() => {
    const event = communikeyEvent;
    const identity = event ? `${event.id ?? ''}:${event.created_at ?? ''}` : '';
    if (!event || identity === seededFrom) return;
    seededFrom = identity;
    const seeded = contentTypesFromEvent(event);
    contentTypes = seeded;
    tierChoices = Object.fromEntries(
      Object.entries(seeded).map(([key, ct]) => [key, tierFromAccess(ct.access)])
    );
  });

  /** The tier a stored access value corresponds to when first loaded.
   * @param {any} access */
  function tierFromAccess(access) {
    if (access?.tier !== 'role') return access?.tier ?? 'all';
    return (access.role ?? '').trim().toLowerCase() === PUBLISHER_ROLE ? 'publisher' : 'role';
  }

  const enabledKeys = $derived(
    Object.keys(contentTypes).filter((key) => contentTypes[key]?.enabled)
  );

  /** @param {string} key @param {string} tier */
  function setTier(key, tier) {
    const current = contentTypes[key];
    if (!current) return;
    const access =
      tier === 'publisher'
        ? { tier: 'role', role: PUBLISHER_ROLE }
        : tier === 'role'
          ? // Seed the free-text box with the role it already had — switching
            // from "Nur Publisher" to "Rolle" is how you edit that role.
            { tier: 'role', role: current.access?.role ?? '' }
          : { tier };
    tierChoices = { ...tierChoices, [key]: /** @type {any} */ (tier) };
    contentTypes = { ...contentTypes, [key]: { ...current, access } };
  }

  /** @param {string} key @param {string} role */
  function setRole(key, role) {
    const current = contentTypes[key];
    if (!current) return;
    contentTypes = { ...contentTypes, [key]: { ...current, access: { tier: 'role', role } } };
  }

  /** @param {string} key */
  const tierValue = (key) => tierChoices[key] ?? tierFromAccess(contentTypes[key]?.access);

  /** A role tier with a blank role parses back as 'all' — i.e. silently
   * opens the section. Block the save rather than publish a broken gate.
   * @param {any} access */
  const roleMissing = (access) => access?.tier === 'role' && !(access.role ?? '').trim();

  const hasBlankRole = $derived(enabledKeys.some((key) => roleMissing(contentTypes[key]?.access)));

  let saving = $state(false);

  async function save() {
    const user = getActiveUser();
    if (!user || !communikeyEvent || saving || hasBlankRole) return;
    saving = true;
    try {
      await publishSectionOverride(
        communikeyEvent.pubkey,
        sectionsFromContentTypes(contentTypes),
        user,
        communikeyEvent
      );
      showToast(m.community_access_editor_saved(), 'success');
    } catch (error) {
      console.error('settings: section override save failed', error);
      showToast(
        m.community_access_editor_save_failed({
          reason: error instanceof Error ? error.message : String(error)
        }),
        'error'
      );
    } finally {
      saving = false;
    }
  }
</script>

<div class="card mb-6 bg-base-100 shadow-xl" data-testid="section-override-pane">
  <div class="card-body">
    <h2 class="card-title">{m.community_access_editor_title()}</h2>
    <p class="text-sm text-base-content/70">{m.community_section_override_lead()}</p>

    {#if overrideAuthor}
      <p class="text-xs text-base-content/50" data-testid="section-override-provenance">
        {m.community_section_override_by({
          name: getUserDisplayName(overrideAuthor, getAuthorProfile())
        })}
      </p>
    {/if}

    <ContentTypesAndACL bind:contentTypes />

    <div class="divide-y divide-base-300">
      {#each enabledKeys as key (key)}
        {@const access = contentTypes[key]?.access ?? { tier: 'all' }}
        <div
          class="flex flex-wrap items-center gap-3 py-3"
          data-testid="section-override-row-{key}"
        >
          <span class="flex-1 truncate text-sm font-semibold"
            >{contentSectionLabel(contentTypes[key]?.name)}</span
          >

          <select
            class="select-bordered select select-sm"
            aria-label={contentTypes[key]?.name}
            value={tierValue(key)}
            onchange={(e) => setTier(key, /** @type {HTMLSelectElement} */ (e.target).value)}
          >
            <option value="all">{m.community_access_all()}</option>
            <option value="members">{m.community_access_members()}</option>
            <option value="publisher">{m.community_access_publisher()}</option>
            <option value="role">{m.community_access_role()}</option>
          </select>

          {#if tierValue(key) === 'role'}
            <input
              type="text"
              class="input-bordered input input-sm"
              list="section-override-roles-{key}"
              placeholder={m.community_access_editor_role_placeholder()}
              value={access.role ?? ''}
              oninput={(e) => setRole(key, /** @type {HTMLInputElement} */ (e.target).value)}
            />
            <datalist id="section-override-roles-{key}">
              {#each suggestedRoles as role (role)}
                <option value={role}></option>
              {/each}
            </datalist>
          {/if}

          {#if roleMissing(access)}
            <p class="w-full text-xs text-error" data-testid="section-override-role-required-{key}">
              {m.community_access_editor_role_required()}
            </p>
          {/if}
        </div>
      {/each}
    </div>

    <div class="card-actions justify-end">
      <button
        class="btn btn-sm btn-primary"
        data-testid="section-override-save"
        disabled={saving || hasBlankRole}
        onclick={save}
      >
        {#if saving}
          <span class="loading loading-xs loading-spinner"></span>
        {/if}
        {m.community_access_editor_save()}
      </button>
    </div>
  </div>
</div>
