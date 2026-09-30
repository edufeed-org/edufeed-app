<script>
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { runtimeConfig, configReady } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte';
  import { useMyAgents } from '$lib/agents/my-agents.svelte.js';
  import { useAdminGroups } from '$lib/agents/admin-groups.svelte.js';
  import { publishAgent } from '$lib/agents/agent-publish.js';
  import AgentEditor from '$lib/components/agents/AgentEditor.svelte';
  import { showToast } from '$lib/helpers/toast.js';
  import * as m from '$lib/paraglide/messages';

  const HEX64 = /^[0-9a-f]{64}$/;
  const agentPubkey = $derived((page.url.searchParams.get('agent') ?? '').toLowerCase());

  const getActiveUser = useActiveUser();
  const getAgents = useMyAgents();
  const getAdminGroups = useAdminGroups();
  const initial = $derived(getAgents().find((a) => a.agentPubkey === agentPubkey) ?? null);
  let busy = $state(false);

  /** @param {{persona: any, addToGroups: any[], removeFromGroups: any[]}} draft */
  async function save(draft) {
    const user = getActiveUser();
    if (!user) return;
    busy = true;
    try {
      const result = await publishAgent({
        user,
        persona: draft.persona,
        record: {
          agentPubkey,
          name: draft.persona.displayName,
          definition: draft.persona.slug,
          respondTo: draft.persona.respondTo
        },
        addToGroups: draft.addToGroups,
        removeFromGroups: draft.removeFromGroups
      });
      if (result.failedGroups.length > 0) {
        showToast(
          m.agents_save_partial({ groups: result.failedGroups.map((g) => g.id).join(', ') }),
          'warning',
          8000
        );
      } else {
        showToast(m.agents_save_done(), 'success');
      }
      await goto(resolve('/c/agents'));
    } catch (error) {
      showToast(
        m.agents_save_failed({ reason: error instanceof Error ? error.message : String(error) }),
        'error',
        8000
      );
    } finally {
      busy = false;
    }
  }
</script>

<svelte:head><title>{m.agents_editor_title()}</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-6">
  <h1 class="mb-4 text-2xl font-semibold">{m.agents_editor_title()}</h1>
  {#if $configReady && !runtimeConfig.agents?.enabled}
    <p class="text-base-content/70">{m.agents_disabled()}</p>
  {:else if !HEX64.test(agentPubkey)}
    <p class="text-error">{m.agents_editor_error_agent()}</p>
  {:else}
    <p class="mb-4 text-sm text-base-content/70">
      {m.agents_editor_agent_id({ id: agentPubkey.slice(0, 12) })}
    </p>
    <AgentEditor
      {agentPubkey}
      {initial}
      groups={getAdminGroups().groups}
      {busy}
      onSave={save}
      onCancel={() => goto(resolve('/c/agents'))}
    />
  {/if}
</div>
