<script>
  import { onMount, onDestroy } from 'svelte';
  import { SimpleAccount } from 'applesauce-accounts/accounts';
  import { merge, Subject, Subscription } from 'rxjs';
  import { manager } from '$lib/stores/accounts.svelte';
  import ThemeSwitcher from '$lib/components/ThemeSwitcher.svelte';
  import * as m from '$lib/paraglide/messages';

  /** @type {any[]} */
  let accounts = [];
  /** @type {any} */
  let activeAccount = null;
  /** @type {Record<string, string>} */
  let names = {}; // per-account editable name

  const manualSave = new Subject();
  let subs = new Subscription();

  onMount(async () => {
    // Load accounts from localStorage and restore manager state
    const savedAccounts = JSON.parse(localStorage.getItem('accounts') || '[]');
    console.log('Restoring accounts:', savedAccounts);
    manager.fromJSON(savedAccounts);

    const activeAccountId = localStorage.getItem('activeAccount');
    if (activeAccountId) {
      const a = manager.getAccount(activeAccountId);
      if (a) manager.setActive(a);
    }

    // subscribe to accounts updates
    subs.add(
      manager.accounts$.subscribe((a) => {
        accounts = a || [];
        // ensure names map contains current metadata names
        for (const acct of accounts) {
          if (!(acct.id in names)) names[acct.id] = (acct.metadata && acct.metadata.name) || '';
        }
        // remove stale entries
        for (const k of Object.keys(names)) {
          if (!accounts.find((x) => x.id === k)) delete names[k];
        }
        // reassign to trigger Svelte reactivity if needed
        names = { ...names };
      })
    );

    // subscribe to active changes
    subs.add(
      manager.active$.subscribe((a) => {
        activeAccount = a || null;
        if (a && !(a.id in names)) names[a.id] = (a.metadata && a.metadata.name) || '';
        if (a) localStorage.setItem('activeAccount', a.id);
        else localStorage.removeItem('activeAccount');
        names = { ...names };
      })
    );

    // save accounts when accounts$ or manualSave emits
    subs.add(
      merge(manualSave, manager.accounts$).subscribe(() => {
        localStorage.setItem('accounts', JSON.stringify(manager.toJSON()));
      })
    );
  });

  onDestroy(() => {
    subs.unsubscribe();
    manualSave.complete();
  });

  /**
   * Save edited name into account metadata.
   * @param {string} accountId
   */
  function saveName(accountId) {
    const acct = manager.getAccount(accountId);
    if (!acct) return;
    manager.setAccountMetadata(acct, { name: names[accountId] || '' });
    manualSave.next(undefined);
  }

  /**
   * Remove account by id.
   * @param {string} accountId
   */
  function removeAccount(accountId) {
    const acct = manager.getAccount(accountId);
    if (!acct) return;
    manager.removeAccount(acct);
  }

  /**
   * Set account active by id.
   * @param {string} accountId
   */
  function setActive(accountId) {
    const acct = manager.getAccount(accountId);
    if (!acct) return;
    manager.setActive(acct);
  }

  /**
   * Create and add a new SimpleAccount.
   */
  function createNewAccount() {
    const acct = SimpleAccount.generateNew();
    acct.metadata = { name: m.account_manager_generated_name({ number: accounts.length + 1 }) };
    manager.addAccount(acct);
  }
</script>

<div class="container mx-auto my-8 p-4">
  <div class="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <h1 class="text-2xl font-bold">{m.account_manager_title()}</h1>
    <button class="btn self-start btn-primary sm:self-auto" onclick={createNewAccount}
      >{m.account_manager_create_button()}</button
    >
  </div>

  <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
    {#each accounts as account (account.id)}
      <div
        class="card bg-base-100 shadow-xl"
        class:border-primary={activeAccount && activeAccount.id === account.id}
        class:border-2={activeAccount && activeAccount.id === account.id}
      >
        <figure class="px-4 pt-4">
          <img
            src={'https://robohash.org/' + account.pubkey + '.png'}
            alt="Account avatar"
            class="h-24 w-24 rounded-full"
          />
        </figure>

        <div class="card-body">
          <input
            type="text"
            class="input-bordered input w-full"
            bind:value={names[account.id]}
            placeholder={m.account_manager_name_placeholder()}
            onblur={() => saveName(account.id)}
          />

          <p class="font-mono text-sm text-base-content/70">
            {account.pubkey.slice(0, 8)}...{account.pubkey.slice(-8)}
          </p>

          <div class="card-actions justify-end">
            <button
              class="btn btn-primary"
              onclick={() => setActive(account.id)}
              disabled={activeAccount && activeAccount.id === account.id}
            >
              {m.account_manager_set_active_button()}
            </button>
            <button class="btn btn-error" onclick={() => removeAccount(account.id)}>
              {m.account_manager_remove_button()}
            </button>
          </div>
        </div>
      </div>
    {/each}
  </div>

  {#if accounts.length === 0}
    <div class="py-12 text-center text-base-content/70">
      {m.account_manager_empty_state()}
    </div>
  {/if}

  <!-- Appearance Settings Section -->
  <div class="divider mt-12"></div>
  <div class="mb-6">
    <h2 class="mb-4 text-xl font-bold">Appearance</h2>
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <ThemeSwitcher />
      </div>
    </div>
  </div>
</div>
