<script>
  import { runtimeConfig, configReady } from '$lib/stores/config.svelte.js';
  import { useActiveUser } from '$lib/stores/accounts.svelte.js';
  import { useProfileMap } from '$lib/stores/profile-map.svelte.js';
  import { parseCordnGroupsConfig } from '$lib/cordn';
  import { composerKeydown } from '$lib/cordn/composer.js';
  import {
    formatMessageTimestamp,
    getUserDisplayName,
    groupMessagesByDate
  } from '$lib/helpers/message-utils.js';
  import ChatMessageList from '$lib/components/chat/ChatMessageList.svelte';
  import ChatMessageRow from '$lib/components/chat/ChatMessageRow.svelte';

  const getActiveUser = useActiveUser();

  const config = $derived(
    $configReady ? parseCordnGroupsConfig(runtimeConfig.cordnGroups) : undefined
  );

  let client = $state.raw(
    /** @type {import('$lib/cordn/client.svelte.js').CordnGroupsClient | undefined} */ (undefined)
  );
  let selectedGid = $state('');
  let newGroupName = $state('');
  let newGroupCoordinator = $state('');
  let inviteePubkey = $state('');
  let draft = $state('');
  let busy = $state(false);
  let actionError = $state('');
  let connectionString = $state('');
  /** Mobile single-column mode: show the chat pane instead of the rail. */
  let mobileChat = $state(false);
  /** @type {HTMLDivElement | undefined} */
  let messagesContainer = $state.raw(undefined);

  const selectedGroup = $derived(client?.groups.find((g) => g.gid === selectedGid));

  const getProfiles = useProfileMap(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient dedupe inside a getter
    const pubkeys = new Set(selectedGroup?.members ?? []);
    for (const message of selectedGroup?.messages ?? []) pubkeys.add(message.pubkey);
    return [...pubkeys];
  });

  /** Adapt stored chat records to Nostr-event-shaped rows for ChatMessageRow. */
  const messageItems = $derived(
    groupMessagesByDate(
      (selectedGroup?.messages ?? []).map((message) => ({
        id: `${selectedGroup?.gid}:${message.cursor}`,
        pubkey: message.pubkey,
        content: message.content,
        created_at: message.at > 1e12 ? Math.floor(message.at / 1000) : message.at,
        tags: []
      }))
    )
  );

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

  // Keep the view pinned to the newest message.
  $effect(() => {
    const count = selectedGroup?.messages.length ?? 0;
    const container = messagesContainer;
    if (!container || count === 0) return;
    container.scrollTop = container.scrollHeight;
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

  /** @param {string} gid */
  function selectGroup(gid) {
    selectedGid = gid;
    mobileChat = true;
  }

  const createGroup = () =>
    run(async (c) => {
      const gid = await c.createGroup(
        newGroupName.trim() || 'Neue Gruppe',
        newGroupCoordinator || undefined
      );
      selectGroup(gid);
      newGroupName = '';
    });

  const addMember = () =>
    run(async (c) => {
      await c.addMemberToGroup(selectedGid, inviteePubkey.trim());
      inviteePubkey = '';
    });

  /** @param {import('$lib/cordn/client.svelte.js').TaggedWelcome} welcome */
  const acceptWelcome = (welcome) =>
    run(async (c) => {
      selectGroup(await c.acceptWelcome(welcome));
    });

  const send = () =>
    run(async (c) => {
      const text = draft.trim();
      if (!text) return;
      await c.send(selectedGid, text);
      draft = '';
    });

  const linkDevice = () =>
    run(async (c) => {
      await c.linkDevice(connectionString.trim());
      connectionString = '';
    });
  const syncNow = () => run((c) => c.syncFromTip());

  let pubkeyCopied = $state(false);
  async function copyPubkey() {
    if (!client) return;
    await navigator.clipboard.writeText(client.pubkey);
    pubkeyCopied = true;
    setTimeout(() => (pubkeyCopied = false), 2000);
  }

  const canInvite = $derived(
    !!selectedGroup &&
      !!client &&
      !selectedGroup.viaSync &&
      (selectedGroup.adminPubkeys.length === 0 ||
        selectedGroup.adminPubkeys.includes(client.pubkey))
  );
</script>

<svelte:head><title>Cordn Labs</title></svelte:head>

{#if !$configReady}
  <div class="p-6"><span class="loading loading-sm loading-spinner"></span></div>
{:else if !config?.enabled}
  <div class="p-6">
    <div class="alert">Cordn-Gruppen sind auf dieser Instanz nicht aktiviert.</div>
  </div>
{:else if !getActiveUser()}
  <div class="p-6"><div class="alert">Bitte zuerst anmelden.</div></div>
{:else if !client || client.status === 'loading' || client.status === 'idle'}
  <div class="flex items-center gap-2 p-6 text-sm opacity-70">
    <span class="loading loading-sm loading-spinner"></span> Verbinde mit dem Koordinator…
  </div>
{:else if client.status === 'error'}
  <div class="p-6">
    <div class="alert alert-error">Initialisierung fehlgeschlagen: {client.error}</div>
  </div>
{:else}
  <div class="flex h-[calc(100dvh-4rem)] min-h-0">
    <!-- Rail: groups + tools. Full width on mobile until a group is opened. -->
    <aside
      class="flex w-full shrink-0 flex-col border-r border-base-300 bg-base-100 md:w-72 {mobileChat
        ? 'hidden md:flex'
        : 'flex'}"
    >
      <header class="border-b border-base-300 px-4 py-3">
        <h1 class="text-lg font-bold">Cordn-Gruppen</h1>
        <p class="flex items-center gap-1 text-xs opacity-60" data-testid="cordn-status">
          <span class="inline-block h-2 w-2 rounded-full bg-success"></span>
          Verbunden
          <button class="btn btn-ghost btn-xs" onclick={copyPubkey} data-testid="cordn-copy-pubkey">
            {pubkeyCopied ? 'Pubkey kopiert ✓' : 'Pubkey kopieren'}
          </button>
        </p>
      </header>

      <nav class="flex-1 space-y-1 overflow-y-auto p-3" data-testid="cordn-group-list">
        {#each client.groups as group (group.gid)}
          <button
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-150 {selectedGid ===
            group.gid
              ? 'bg-primary/10 font-medium text-primary'
              : 'hover:bg-base-200'}"
            onclick={() => selectGroup(group.gid)}
          >
            <span
              class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-base-300 text-xs font-semibold uppercase"
            >
              {group.name.slice(0, 2)}
            </span>
            <span class="min-w-0 flex-1 truncate">{group.name}</span>
            {#if group.viaSync}
              <span class="badge badge-ghost badge-xs" title="Über Geräte-Sync">⇄</span>
            {/if}
            <span class="badge badge-ghost badge-sm">{group.members.length}</span>
          </button>
        {:else}
          <p class="px-2 py-4 text-sm opacity-60">Noch keine Gruppen.</p>
        {/each}
      </nav>

      <div class="space-y-3 border-t border-base-300 p-3">
        <form class="join w-full" onsubmit={(e) => (e.preventDefault(), createGroup())}>
          <input
            class="input input-sm join-item w-full"
            placeholder="Neue Gruppe…"
            bind:value={newGroupName}
            data-testid="cordn-new-group-name"
          />
          <button class="btn join-item btn-sm btn-primary" disabled={busy} type="submit">
            Anlegen
          </button>
        </form>
        {#if (config?.coordinatorPubkeys.length ?? 0) > 1}
          <select
            class="select w-full select-sm font-mono"
            bind:value={newGroupCoordinator}
            data-testid="cordn-new-group-coordinator"
          >
            {#each config?.coordinatorPubkeys ?? [] as pubkey, index (pubkey)}
              <option value={index === 0 ? '' : pubkey}>
                Koordinator {pubkey.slice(0, 8)}…{index === 0 ? ' (Standard)' : ''}
              </option>
            {/each}
          </select>
        {/if}

        <details class="collapse-arrow collapse rounded-lg bg-base-200">
          <summary class="collapse-title min-h-0 py-2 text-sm font-medium">
            Geräte-Sync
            {#if client.multiDevice}<span class="badge badge-xs badge-success">aktiv</span>{/if}
          </summary>
          <div class="collapse-content space-y-2 text-xs">
            {#if client.multiDevice}
              <p class="opacity-70" data-testid="cordn-md-status">
                Verknüpft · {client.multiDevice.lastSyncAt
                  ? `zuletzt ${new Date(client.multiDevice.lastSyncAt).toLocaleTimeString('de-DE')}`
                  : 'noch nicht synchronisiert'}
              </p>
              <button class="btn w-full btn-sm" disabled={busy} onclick={syncNow}>
                Jetzt synchronisieren
              </button>
            {:else}
              <p class="opacity-60">
                Verbindungscode aus cordn.net einfügen, um Gruppen dieser Identität zu übernehmen.
              </p>
              <form class="join w-full" onsubmit={(e) => (e.preventDefault(), linkDevice())}>
                <input
                  class="input input-xs join-item w-full font-mono"
                  placeholder="Verbindungscode…"
                  bind:value={connectionString}
                  data-testid="cordn-md-connection"
                />
                <button
                  class="btn join-item btn-xs btn-primary"
                  disabled={busy || !connectionString.trim()}
                  type="submit"
                >
                  Verbinden
                </button>
              </form>
            {/if}
          </div>
        </details>

        <details class="collapse-arrow collapse rounded-lg bg-base-200">
          <summary class="collapse-title min-h-0 py-2 text-sm font-medium">
            Einladungen
            {#if client.welcomes.length > 0}
              <span class="badge badge-xs badge-primary">{client.welcomes.length}</span>
            {/if}
          </summary>
          <div class="collapse-content space-y-2 text-xs">
            <button
              class="btn w-full btn-sm"
              disabled={busy}
              onclick={() => run((c) => c.refreshWelcomes())}
            >
              Aktualisieren
            </button>
            <ul class="space-y-1" data-testid="cordn-welcome-list">
              {#each client.welcomes as welcome (`${welcome.coordinatorPubkey}:${welcome.kp_ref}`)}
                <li class="flex items-center justify-between gap-2">
                  <span class="truncate">Einladung {welcome.kp_ref.slice(0, 8)}…</span>
                  <button
                    class="btn btn-xs btn-primary"
                    disabled={busy}
                    onclick={() => acceptWelcome(welcome)}
                  >
                    Annehmen
                  </button>
                </li>
              {:else}
                <li class="opacity-60">Keine offenen Einladungen</li>
              {/each}
            </ul>
          </div>
        </details>
      </div>
    </aside>

    <!-- Chat pane -->
    <main class="flex min-w-0 flex-1 flex-col {mobileChat ? 'flex' : 'hidden md:flex'}">
      {#if actionError}
        <div class="m-3 alert alert-error" data-testid="cordn-action-error">{actionError}</div>
      {/if}
      {#if client.error}
        <div class="m-3 alert text-sm alert-warning" data-testid="cordn-client-warning">
          {client.error}
        </div>
      {/if}

      {#if selectedGroup}
        <header class="flex items-center gap-2 border-b border-base-300 bg-base-100 px-4 py-2">
          <button
            class="btn btn-ghost btn-sm md:hidden"
            onclick={() => (mobileChat = false)}
            aria-label="Zurück zur Gruppenliste"
          >
            ←
          </button>
          <div class="min-w-0 flex-1">
            <h2 class="truncate font-semibold">{selectedGroup.name}</h2>
            <p class="truncate text-xs opacity-60">
              {selectedGroup.members.length} Mitglieder
              {#if selectedGroup.viaSync}· synchronisiert via cordn.net{/if}
            </p>
          </div>
          {#if canInvite}
            <form class="join hidden sm:flex" onsubmit={(e) => (e.preventDefault(), addMember())}>
              <input
                class="input input-sm join-item w-44 font-mono"
                placeholder="Pubkey einladen…"
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
          {/if}
        </header>

        <div
          class="flex-1 overflow-y-auto px-4 py-3"
          bind:this={messagesContainer}
          data-testid="cordn-message-list"
        >
          {#if messageItems.length === 0}
            <p class="py-8 text-center text-sm opacity-60">Noch keine Nachrichten</p>
          {:else}
            <ChatMessageList items={messageItems}>
              {#snippet row(message)}
                <ChatMessageRow
                  {message}
                  isOwnMessage={message.pubkey === client?.pubkey}
                  displayName={getUserDisplayName(
                    message.pubkey,
                    getProfiles().get(message.pubkey)
                  )}
                  timestamp={formatMessageTimestamp(message.created_at)}
                  profile={getProfiles().get(message.pubkey)}
                />
              {/snippet}
            </ChatMessageList>
          {/if}
        </div>

        <footer class="border-t border-base-300 bg-base-100 p-3">
          <form class="flex items-end gap-2" onsubmit={(e) => (e.preventDefault(), send())}>
            <textarea
              class="textarea max-h-40 min-h-10 flex-1"
              rows="1"
              placeholder="Nachricht… (Enter sendet, Shift/Alt+Enter = neue Zeile)"
              bind:value={draft}
              onkeydown={(e) => composerKeydown(e, send)}
              data-testid="cordn-message-input"
            ></textarea>
            <button class="btn btn-primary" disabled={busy || !draft.trim()} type="submit">
              Senden
            </button>
          </form>
        </footer>
      {:else}
        <div class="flex flex-1 items-center justify-center">
          <p class="text-sm opacity-60">Gruppe auswählen oder anlegen.</p>
        </div>
      {/if}
    </main>
  </div>
{/if}
