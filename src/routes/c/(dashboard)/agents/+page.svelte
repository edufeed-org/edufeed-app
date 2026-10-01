<script>
  import { resolve } from '$app/paths';
  import { runtimeConfig, configReady } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useMyAgents } from '$lib/agents/my-agents.svelte.js';
  import { useAdminGroups } from '$lib/agents/admin-groups.svelte.js';
  import { useAgentPresence } from '$lib/agents/agent-presence.svelte.js';
  import { presenceIsOnline } from '$lib/agents/agent-index.js';
  import { removeAgent } from '$lib/agents/agent-publish.js';
  import { personaSlugForAgent } from '$lib/agents/persona.js';
  import { showToast } from '$lib/helpers/toast.js';
  import * as m from '$lib/paraglide/messages';

  const getActiveUser = useActiveUser();
  const getAgents = useMyAgents();
  const getAdminGroups = useAdminGroups();
  const getPresence = useAgentPresence(() => getAgents().map((a) => a.agentPubkey));
  const now = () => Math.floor(Date.now() / 1000);

  /** @type {import('$lib/agents/agent-index.js').AgentEntry | null} */
  let removeTarget = $state(null);
  let removing = $state(false);

  async function confirmRemove() {
    const user = getActiveUser();
    const target = removeTarget;
    if (!user || !target) return;
    removing = true;
    try {
      const groups = getAdminGroups()
        .groups.filter((g) => g.members.has(target.agentPubkey))
        .map((g) => ({ id: g.id, relay: g.relay }));
      const result = await removeAgent({
        user,
        agentPubkey: target.agentPubkey,
        slug: target.persona?.slug ?? target.definition ?? personaSlugForAgent(target.agentPubkey),
        groups
      });
      if (result.failedGroups.length > 0) {
        showToast(m.agents_remove_partial({ count: result.failedGroups.length }), 'warning', 6000);
      } else {
        showToast(m.agents_remove_done(), 'success');
      }
      removeTarget = null;
    } catch (error) {
      showToast(
        m.agents_remove_failed({ reason: error instanceof Error ? error.message : String(error) }),
        'error',
        6000
      );
    } finally {
      removing = false;
    }
  }
</script>

<svelte:head><title>{m.agents_title()}</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-6">
  {#if $configReady && !runtimeConfig.agents?.enabled}
    <p class="text-base-content/70">{m.agents_disabled()}</p>
  {:else}
    <div class="mb-6 flex items-center justify-between">
      <h1 class="text-2xl font-semibold">{m.agents_title()}</h1>
    </div>

    <section class="card mb-8 bg-base-100 shadow-sm">
      <div class="card-body">
        <h2 class="card-title">{m.agents_add_title()}</h2>
        <ol class="list-inside list-decimal space-y-1 text-sm">
          <li>{m.agents_add_step_download()}</li>
          <li>{m.agents_add_step_open()}</li>
          <li>{m.agents_add_step_configure()}</li>
        </ol>
        <div class="mt-2 card-actions">
          {#if runtimeConfig.agents?.downloadUrl}
            <a class="btn btn-sm btn-primary" href={runtimeConfig.agents.downloadUrl}
              >{m.agents_add_download()}</a
            >
          {:else}
            <span class="text-sm text-base-content/70">{m.agents_add_download_missing()}</span>
          {/if}
        </div>
      </div>
    </section>

    <h2 class="mb-3 text-lg font-semibold">{m.agents_mine_title()}</h2>
    {#if getAgents().length === 0}
      <p class="text-base-content/70">{m.agents_mine_empty()}</p>
    {:else}
      <ul class="flex flex-col gap-3">
        {#each getAgents() as agent (agent.agentPubkey)}
          {@const online = presenceIsOnline(getPresence().get(agent.agentPubkey), now())}
          <li class="card bg-base-100 shadow-sm">
            <div class="card-body flex-row items-center gap-4">
              <span
                class="inline-block h-2.5 w-2.5 shrink-0 rounded-full {online
                  ? 'bg-success'
                  : 'bg-base-300'}"
                title={online ? m.agents_status_online() : m.agents_status_offline()}
              ></span>
              <div class="min-w-0 flex-1">
                <div class="truncate font-semibold">{agent.name}</div>
                <div class="text-sm text-base-content/70">
                  {agent.persona?.runtime ?? '—'} · {agent.respondTo === 'anyone'
                    ? m.agents_editor_respond_members()
                    : m.agents_editor_respond_owner()}
                </div>
              </div>
              <a
                class="btn btn-sm"
                href={resolve('/c/(dashboard)/agents/[pubkey]', { pubkey: agent.agentPubkey })}
                >{m.agents_edit()}</a
              >
              <button
                type="button"
                class="btn btn-ghost btn-sm"
                onclick={() => (removeTarget = agent)}>{m.agents_remove()}</button
              >
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

{#if removeTarget}
  <div class="modal-open modal">
    <div class="modal-box max-w-sm">
      <h3 class="text-lg font-semibold">
        {m.agents_remove_confirm_title({ name: removeTarget.name })}
      </h3>
      <p class="py-2 text-sm">
        {#if getAdminGroups().loading}
          {m.agents_remove_loading()}
        {:else}
          {m.agents_remove_confirm_body()}
        {/if}
      </p>
      <div class="modal-action">
        <button
          type="button"
          class="btn btn-ghost"
          onclick={() => (removeTarget = null)}
          disabled={removing}>{m.agents_editor_cancel()}</button
        >
        <button
          type="button"
          class="btn btn-error"
          onclick={confirmRemove}
          disabled={removing || getAdminGroups().loading}>{m.agents_remove()}</button
        >
      </div>
    </div>
  </div>
{/if}
