<!--
  CallInviteDialog — guest links for the running call (call passes,
  groups/call-passes.js). Any channel member creates them; the author or a
  channel moderator revokes them, which also removes guests already inside.
  A link stops working when the call ends.
-->
<script>
  import { onMount } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    TITLE_MAX_CHARS,
    createCallLink,
    listCallPasses,
    passLinkFor,
    revokeCallPass
  } from '$lib/groups/call-passes.js';
  import { pool } from '$lib/stores/nostr-infrastructure.svelte';
  import { sendWrappedDm } from '$lib/services/wrapped-dm.js';
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import { showToast } from '$lib/helpers/toast';
  import * as m from '$lib/paraglide/messages';

  /** @type {{pointer: {id: string, relay: string}, user: {pubkey: string, signer: any}, isAdmin: boolean, title: string, onClose: () => void}} */
  let { pointer, user, isAdmin, title, onClose } = $props();

  /** @type {Array<{pass: any, url: string | null}>} */
  let rows = $state.raw([]);
  let loading = $state(true);
  let creating = $state(false);
  // Optional name for the next link ("Elternabend"), shown in "Aktive Links".
  let linkTitle = $state('');
  /** @type {string | null} */
  let latestUrl = $state(null);
  let dmOpen = $state(false);
  let sending = $state(false);
  // listCallPasses REJECTS on relay error/timeout (not an empty list) — a
  // relay hiccup must not look like "nobody has a link yet", and "Link
  // erstellen" must keep working even though the list failed. A pass
  // created after the failure still goes into `rows`, so the error is
  // shown ALONGSIDE the list, never in place of it (otherwise a freshly
  // created link's only "Zurückziehen" button would be unreachable).
  let listError = $state(false);
  // Per-pass in-flight guard: a double-click on "Zurückziehen" must not
  // fire two revocations for the same pass.
  let revoking = $state.raw(new SvelteSet());

  const relay = () => pool.relay(pointer.relay);

  onMount(async () => {
    try {
      const passes = await listCallPasses(relay(), pointer.id, user);
      const fetched = await Promise.all(
        passes.map(async (pass) => ({
          pass,
          url: await passLinkFor(pass, user, pointer, location.origin)
        }))
      );
      // A link created (via "Link erstellen") while this listing was still
      // in flight must not be clobbered by the fetched list — merge by pass
      // id, keeping anything created meanwhile that the fetch doesn't know
      // about yet.
      const fetchedIds = new Set(fetched.map((r) => r.pass.id));
      const createdMeanwhile = rows.filter((r) => !fetchedIds.has(r.pass.id));
      rows = [...createdMeanwhile, ...fetched];
    } catch (err) {
      console.warn('call links: listing failed', err);
      listError = true;
    } finally {
      loading = false;
    }
  });

  /** @param {any} pass @returns {string} */
  function passTitle(pass) {
    const value = pass?.tags?.find((/** @type {string[]} */ t) => t[0] === 'title')?.[1];
    return typeof value === 'string' ? value.trim() : '';
  }

  /** @param {unknown} err */
  function failure(err) {
    const reason = err instanceof Error ? err.message : String(err);
    showToast(
      reason === 'nip44-unsupported'
        ? m.groups_call_invite_nip44()
        : m.groups_call_invite_failed({ reason }),
      'error'
    );
  }

  async function create() {
    if (creating) return;
    creating = true;
    try {
      const { url, event } = await createCallLink(relay(), pointer, user, location.origin, {
        title: linkTitle
      });
      latestUrl = url;
      linkTitle = '';
      rows = [{ pass: event, url }, ...rows];
    } catch (err) {
      failure(err);
    } finally {
      creating = false;
    }
  }

  /** @param {string} url */
  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      showToast(m.groups_call_invite_copied(), 'success');
    } catch {
      showToast(m.groups_call_invite_copy_failed(), 'error');
    }
  }

  /** @param {string} pubkey */
  async function sendDm(pubkey) {
    if (!latestUrl || sending) return;
    sending = true;
    try {
      await sendWrappedDm(pubkey, m.groups_call_invite_dm({ title, url: latestUrl }));
      showToast(m.groups_call_invite_dm_sent(), 'success');
      dmOpen = false;
    } catch (err) {
      failure(err);
    } finally {
      sending = false;
    }
  }

  /** @param {any} pass */
  async function revoke(pass) {
    if (revoking.has(pass.id)) return;
    revoking.add(pass.id);
    try {
      await revokeCallPass(relay(), pass, user, { asAdmin: isAdmin });
      const revokedRow = rows.find((r) => r.pass.id === pass.id);
      rows = rows.filter((r) => r.pass.id !== pass.id);
      // Never show a URL whose pass is no longer in `rows` — clear it
      // specifically when the revoked row is the one currently displayed,
      // not just when the whole list emptied out.
      if (revokedRow && revokedRow.url === latestUrl) latestUrl = null;
      showToast(m.groups_call_invite_revoked(), 'success');
    } catch (err) {
      failure(err);
    } finally {
      revoking.delete(pass.id);
    }
  }
</script>

<div class="modal-open modal" role="dialog" aria-modal="true" data-testid="call-invite-dialog">
  <div class="modal-box max-w-md">
    <h3 class="text-lg font-bold">{m.groups_call_invite_title()}</h3>
    <p class="mt-2 text-sm text-base-content/70">{m.groups_call_invite_explainer()}</p>

    {#if latestUrl}
      <div class="mt-4 flex gap-2">
        <input
          class="input-bordered input flex-1"
          readonly
          value={latestUrl}
          data-testid="call-invite-url"
        />
        <button
          class="btn"
          onclick={() => copy(/** @type {string} */ (latestUrl))}
          data-testid="call-invite-copy"
        >
          {m.groups_call_invite_copy()}
        </button>
      </div>
      <button class="btn mt-2 btn-ghost btn-sm" onclick={() => (dmOpen = !dmOpen)}>
        {m.groups_call_invite_send_dm()}
      </button>
      {#if dmOpen}
        <ContactSearchInput
          acceptPubkeyInput
          inlineList
          searchProfiles
          disabled={sending}
          placeholder={m.groups_members_add_placeholder()}
          onselect={(/** @type {{pubkey: string}} */ c) => sendDm(c.pubkey)}
          onrawpubkey={(/** @type {string} */ hex) => sendDm(hex)}
        />
      {/if}
    {:else}
      <input
        class="input-bordered input mt-4 w-full"
        type="text"
        maxlength={TITLE_MAX_CHARS}
        placeholder={m.groups_call_invite_title_placeholder()}
        aria-label={m.groups_call_invite_title_placeholder()}
        bind:value={linkTitle}
        disabled={creating}
        data-testid="call-invite-title"
      />
      <button
        class="btn mt-2 btn-primary"
        onclick={create}
        disabled={creating}
        data-testid="call-invite-create"
      >
        {#if creating}<span class="loading loading-sm loading-spinner"></span>{/if}
        {m.groups_call_invite_create()}
      </button>
    {/if}

    <h4 class="mt-6 text-sm font-semibold">{m.groups_call_invite_active()}</h4>
    {#if listError}
      <p class="mt-1 text-sm text-error" data-testid="call-invite-list-error">
        {m.groups_call_invite_list_failed()}
      </p>
    {/if}
    {#if loading}
      <span class="loading loading-sm loading-dots"></span>
    {:else if rows.length === 0}
      {#if !listError}
        <p class="text-sm text-base-content/60">{m.groups_call_invite_none()}</p>
      {/if}
    {:else}
      <ul class="mt-2 flex flex-col gap-2">
        {#each rows as row (row.pass.id)}
          <li class="flex items-center gap-2 text-sm" data-testid="call-invite-pass">
            <span class="min-w-0 flex-1">
              {#if passTitle(row.pass)}
                <span class="font-medium break-words" data-testid="call-invite-pass-title"
                  >{passTitle(row.pass)}</span
                > ·
              {/if}
              {new Date(row.pass.created_at * 1000).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })}
              {#if row.pass.pubkey !== user.pubkey}· {m.groups_call_invite_by_other()}{/if}
            </span>
            {#if row.url}
              <button
                class="btn btn-ghost btn-sm"
                onclick={() => copy(/** @type {string} */ (row.url))}
              >
                {m.groups_call_invite_copy()}
              </button>
            {/if}
            {#if row.pass.pubkey === user.pubkey || isAdmin}
              <button
                class="btn text-error btn-ghost btn-sm"
                onclick={() => revoke(row.pass)}
                disabled={revoking.has(row.pass.id)}
                data-testid="call-invite-revoke"
              >
                {m.groups_call_invite_revoke()}
              </button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <div class="modal-action">
      <button class="btn btn-ghost" onclick={onClose}>{m.groups_call_invite_close()}</button>
    </div>
  </div>
  <button class="modal-backdrop" aria-label={m.groups_call_invite_close()} onclick={onClose}
  ></button>
</div>
