<script>
  /**
   * Persona editor: name, picture, instructions, runtime, who may talk to
   * it, groups. Validation and the resulting draft are pure (persona.js);
   * publishing is the caller's job (onSave), so this component is testable
   * without relays.
   */
  import {
    validatePersona,
    RUNTIMES,
    RESPOND_TO,
    personaSlugForAgent
  } from '$lib/agents/persona.js';
  import * as m from '$lib/paraglide/messages';

  /** @type {{ agentPubkey: string, initial?: import('$lib/agents/agent-index.js').AgentEntry | null, groups: import('$lib/agents/admin-groups.svelte.js').AdminGroup[], busy?: boolean, loading?: boolean, onSave: (draft: {persona: any, addToGroups: Array<{id: string, relay: string}>, removeFromGroups: Array<{id: string, relay: string}>}) => Promise<void>, onCancel: () => void }} */
  let {
    agentPubkey,
    initial = null,
    groups,
    busy = false,
    loading = false,
    onSave,
    onCancel
  } = $props();

  let displayName = $state(initial?.persona?.displayName ?? initial?.name ?? '');
  let avatarUrl = $state(initial?.persona?.avatarUrl ?? '');
  let systemPrompt = $state(initial?.persona?.systemPrompt ?? '');
  let runtime = $state(
    initial?.persona?.runtime && RUNTIMES.includes(/** @type {any} */ (initial.persona.runtime))
      ? initial.persona.runtime
      : 'claude'
  );
  let respondTo = $state(
    initial?.respondTo && RESPOND_TO.includes(/** @type {any} */ (initial.respondTo))
      ? initial.respondTo
      : 'owner-only'
  );
  /** @type {'name' | 'runtime' | 'respondTo' | ''} */
  let error = $state('');

  // Groups the agent is in right now, always recomputed off the `groups`
  // prop — never frozen at mount, so a roster that finishes loading after
  // this component first renders (kind 30177 put-user events load
  // asynchronously) is reflected correctly on the very next render.
  const currentIds = $derived(
    new Set(groups.filter((g) => g.members.has(agentPubkey)).map((g) => g.id))
  );

  // What the user has actually clicked, as a diff against currentIds — NOT
  // an absolute selection snapshot. Keeping only the diff means a save that
  // happens before `groups`/`initial` finished loading can never remove a
  // membership the user never touched: isSelected() combines the always-
  // fresh currentIds with this (empty-until-clicked) diff on every render,
  // instead of copying currentIds once into a selection set at mount.
  let toggled = $state.raw(/** @type {Set<string>} */ (new Set()));

  /** @param {string} id */
  const isSelected = (id) => currentIds.has(id) !== toggled.has(id);

  /** @param {string} id */
  function toggle(id) {
    const next = new Set(toggled); // eslint-disable-line svelte/prefer-svelte-reactivity -- local accumulator, reassigned to $state.raw below
    if (next.has(id)) next.delete(id);
    else next.add(id);
    toggled = next;
  }

  const adminGroups = $derived(groups.filter((g) => g.isAdmin));
  const loadingGroups = $derived(groups.filter((g) => !g.loaded));

  /** @param {{id: string, relay: string}} g */
  const pointer = (g) => ({ id: g.id, relay: g.relay });
  const addToGroups = $derived(
    adminGroups.filter((g) => toggled.has(g.id) && !currentIds.has(g.id)).map(pointer)
  );
  const removeFromGroups = $derived(
    adminGroups.filter((g) => toggled.has(g.id) && currentIds.has(g.id)).map(pointer)
  );

  async function save() {
    const result = validatePersona({
      displayName,
      systemPrompt,
      runtime,
      avatarUrl: avatarUrl.trim() || null,
      respondTo
    });
    if (!result.ok) {
      error = result.error;
      return;
    }
    error = '';
    const persona = { ...result.value, slug: personaSlugForAgent(agentPubkey) };
    await onSave({ persona, addToGroups, removeFromGroups });
  }
</script>

<form
  class="flex flex-col gap-4"
  onsubmit={(e) => {
    e.preventDefault();
    save();
  }}
>
  <label class="form-control">
    <span class="label-text">{m.agents_editor_name()}</span>
    <input
      class="input-bordered input"
      bind:value={displayName}
      aria-label={m.agents_editor_name()}
      required
    />
    {#if error === 'name'}<span class="text-sm text-error">{m.agents_editor_error_name()}</span
      >{/if}
  </label>

  <label class="form-control">
    <span class="label-text">{m.agents_editor_picture()}</span>
    <input
      class="input-bordered input"
      type="url"
      bind:value={avatarUrl}
      aria-label={m.agents_editor_picture()}
      placeholder="https://"
    />
  </label>

  <label class="form-control">
    <span class="label-text">{m.agents_editor_instructions()}</span>
    <textarea
      class="textarea-bordered textarea min-h-32"
      bind:value={systemPrompt}
      aria-label={m.agents_editor_instructions()}
    ></textarea>
  </label>

  <fieldset class="form-control">
    <legend class="label-text mb-1">{m.agents_editor_runtime()}</legend>
    <label class="flex items-center gap-2"
      ><input type="radio" class="radio radio-sm" bind:group={runtime} value="claude" />
      {m.agents_editor_runtime_claude()}</label
    >
    <label class="flex items-center gap-2"
      ><input type="radio" class="radio radio-sm" bind:group={runtime} value="codex" />
      {m.agents_editor_runtime_codex()}</label
    >
    <label class="flex items-center gap-2"
      ><input type="radio" class="radio radio-sm" bind:group={runtime} value="buzz-agent" />
      {m.agents_editor_runtime_own_key()}</label
    >
  </fieldset>

  <fieldset class="form-control">
    <legend class="label-text mb-1">{m.agents_editor_respond_to()}</legend>
    <label class="flex items-center gap-2"
      ><input type="radio" class="radio radio-sm" bind:group={respondTo} value="owner-only" />
      {m.agents_editor_respond_owner()}</label
    >
    <label class="flex items-center gap-2"
      ><input type="radio" class="radio radio-sm" bind:group={respondTo} value="anyone" />
      {m.agents_editor_respond_members()}</label
    >
  </fieldset>

  <fieldset class="form-control">
    <legend class="label-text mb-1">{m.agents_editor_groups()}</legend>
    {#if adminGroups.length === 0 && loadingGroups.length === 0}
      <p class="text-sm text-base-content/70">{m.agents_editor_groups_none()}</p>
    {/if}
    {#each adminGroups as group (group.key)}
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox checkbox-sm"
          checked={isSelected(group.id)}
          onchange={() => toggle(group.id)}
          aria-label={group.name}
        />
        {group.name}
      </label>
    {/each}
    {#each loadingGroups as group (group.key)}
      <div class="flex items-center gap-2 text-sm text-base-content/60">
        <span class="loading loading-xs loading-spinner"></span>{m.agents_editor_group_loading()}
      </div>
    {/each}
  </fieldset>

  <div class="flex justify-end gap-2">
    <button type="button" class="btn btn-ghost" onclick={onCancel} disabled={busy}
      >{m.agents_editor_cancel()}</button
    >
    <button type="submit" class="btn btn-primary" disabled={busy || loading}>
      {#if busy}<span class="loading loading-sm loading-spinner"></span>{/if}
      {m.agents_editor_save()}
    </button>
  </div>
</form>
