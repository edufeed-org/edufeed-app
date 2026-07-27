<script>
  import { runtimeConfig, configReady } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { parseCordnGroupsConfig } from '$lib/cordn';

  const getActiveUser = useActiveUser();

  const config = $derived(
    $configReady ? parseCordnGroupsConfig(runtimeConfig.cordnGroups) : undefined
  );

  let client = $state.raw(
    /** @type {import('$lib/cordn/client.svelte.js').CordnGroupsClient | undefined} */ (undefined)
  );
  let selectedGid = $state('');
  let newGroupName = $state('');
  let inviteePubkey = $state('');
  let draft = $state('');
  let busy = $state(false);
  let actionError = $state('');

  const selectedGroup = $derived(client?.groups.find((g) => g.gid === selectedGid));

  $effect(() => {
    const account = getActiveUser();
    const enabled = config?.enabled;
    if (!enabled || !account?.signer) return;
    let generation = true;
    /** @type {import('$lib/cordn/client.svelte.js').CordnGroupsClient | undefined} */
    let created;
    (async () => {
      const { CordnGroupsClient } = await import('$lib/cordn/client.svelte.js');
      if (!generation) return;
      created = new CordnGroupsClient({
        pubkey: account.pubkey,
        signer: account.signer,
        config
      });
      client = created;
      await created.init();
    })();
    return () => {
      generation = false;
      client = undefined;
      void created?.destroy();
    };
  });

  /** @param {(c: import('$lib/cordn/client.svelte.js').CordnGroupsClient) => Promise<unknown>} action */
  async function run(action) {
    const c = client;
    if (!c) return;
    busy = true;
    actionError = '';
    try {
      await action(c);
    } catch (error) {
      actionError = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  }

  const createGroup = () =>
    run(async (c) => {
      const gid = await c.createGroup(newGroupName.trim() || 'Neue Gruppe');
      selectedGid = gid;
      newGroupName = '';
    });

  const addMember = () =>
    run(async (c) => {
      await c.addMemberToGroup(selectedGid, inviteePubkey.trim());
      inviteePubkey = '';
    });

  /** @param {{kp_ref: string, welcome_64: string, at: number, after?: number}} welcome */
  const acceptWelcome = (welcome) =>
    run(async (c) => {
      selectedGid = await c.acceptWelcome(welcome);
    });

  const send = () =>
    run(async (c) => {
      const text = draft.trim();
      if (!text) return;
      await c.send(selectedGid, text);
      draft = '';
    });

  /** @param {string} pubkey */
  const shortPubkey = (pubkey) => `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`;
</script>

<svelte:head><title>Cordn Labs</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-4 p-4">
  <h1 class="text-2xl font-bold">Cordn-Gruppen (Spike)</h1>

  {#if !$configReady}
    <p>Konfiguration wird geladen…</p>
  {:else if !config?.enabled}
    <div class="alert">Cordn-Gruppen sind auf dieser Instanz nicht aktiviert.</div>
  {:else if !getActiveUser()}
    <div class="alert">Bitte zuerst anmelden.</div>
  {:else if !client || client.status === 'loading' || client.status === 'idle'}
    <p>Verbinde mit dem Koordinator…</p>
  {:else if client.status === 'error'}
    <div class="alert alert-error">Initialisierung fehlgeschlagen: {client.error}</div>
  {:else}
    <p class="text-sm opacity-70" data-testid="cordn-status">
      Verbunden · KeyPackage {client.keyPackageRef.slice(0, 12)}…
    </p>

    {#if actionError}
      <div class="alert alert-error" data-testid="cordn-action-error">{actionError}</div>
    {/if}

    <div class="grid gap-4 md:grid-cols-[280px_1fr]">
      <aside class="space-y-4">
        <section class="card space-y-2 bg-base-100 p-3">
          <h2 class="font-semibold">Gruppen</h2>
          <ul class="menu p-0" data-testid="cordn-group-list">
            {#each client.groups as group (group.gid)}
              <li>
                <button
                  class={selectedGid === group.gid ? 'menu-active' : ''}
                  onclick={() => (selectedGid = group.gid)}
                >
                  {group.name}
                  <span class="badge badge-sm">{group.members.length}</span>
                </button>
              </li>
            {/each}
          </ul>
          <form class="join w-full" onsubmit={(e) => (e.preventDefault(), createGroup())}>
            <input
              class="input input-sm join-item w-full"
              placeholder="Gruppenname"
              bind:value={newGroupName}
              data-testid="cordn-new-group-name"
            />
            <button class="btn join-item btn-sm btn-primary" disabled={busy} type="submit">
              Anlegen
            </button>
          </form>
        </section>

        <section class="card space-y-2 bg-base-100 p-3">
          <h2 class="font-semibold">Einladungen</h2>
          <button
            class="btn btn-sm"
            disabled={busy}
            onclick={() => run((c) => c.refreshWelcomes())}
          >
            Aktualisieren
          </button>
          <ul class="space-y-1" data-testid="cordn-welcome-list">
            {#each client.welcomes as welcome (welcome.kp_ref)}
              <li class="flex items-center justify-between gap-2 text-sm">
                <span>Einladung {welcome.kp_ref.slice(0, 8)}…</span>
                <button
                  class="btn btn-xs btn-primary"
                  disabled={busy}
                  onclick={() => acceptWelcome(welcome)}
                >
                  Annehmen
                </button>
              </li>
            {:else}
              <li class="text-sm opacity-60">Keine offenen Einladungen</li>
            {/each}
          </ul>
        </section>
      </aside>

      <main class="card space-y-3 bg-base-100 p-3">
        {#if selectedGroup}
          <header class="flex items-center justify-between">
            <h2 class="font-semibold">{selectedGroup.name}</h2>
            <span class="text-xs opacity-60">
              Mitglieder: {selectedGroup.members.map(shortPubkey).join(', ')}
            </span>
          </header>

          <form class="join w-full" onsubmit={(e) => (e.preventDefault(), addMember())}>
            <input
              class="input input-sm join-item w-full font-mono"
              placeholder="Hex-Pubkey einladen…"
              bind:value={inviteePubkey}
              data-testid="cordn-invitee-pubkey"
            />
            <button
              class="btn join-item btn-sm"
              disabled={busy || !inviteePubkey.trim()}
              type="submit"
            >
              Einladen
            </button>
          </form>

          <ul class="min-h-40 space-y-2" data-testid="cordn-message-list">
            {#each selectedGroup.messages as message (message.cursor)}
              <li class="chat {message.pubkey === client.pubkey ? 'chat-end' : 'chat-start'}">
                <div class="chat-header text-xs opacity-60">{shortPubkey(message.pubkey)}</div>
                <div class="chat-bubble">{message.content}</div>
              </li>
            {:else}
              <li class="text-sm opacity-60">Noch keine Nachrichten</li>
            {/each}
          </ul>

          <form class="join w-full" onsubmit={(e) => (e.preventDefault(), send())}>
            <input
              class="input join-item w-full"
              placeholder="Nachricht…"
              bind:value={draft}
              data-testid="cordn-message-input"
            />
            <button
              class="btn join-item btn-primary"
              disabled={busy || !draft.trim()}
              type="submit"
            >
              Senden
            </button>
          </form>
        {:else}
          <p class="opacity-60">Gruppe auswählen oder anlegen.</p>
        {/if}
      </main>
    </div>
  {/if}
</div>
