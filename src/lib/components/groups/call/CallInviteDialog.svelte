<!--
  CallInviteDialog — guest links for the running call (call passes,
  groups/call-passes.js). Any channel member creates them; the author or a
  channel moderator revokes them, which also removes guests already inside.
  A link stops working when the call ends.
-->
<script>
  import { onMount, onDestroy } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import {
    TITLE_MAX_CHARS,
    createCallLink,
    listCallPasses,
    passLinkFor,
    revokeCallPass
  } from '$lib/groups/call-passes.js';
  import { getGroupCallState } from '$lib/groups/group-call.svelte.js';
  import { formatTimeOfDay } from '$lib/helpers/dates.js';
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
  const call = getGroupCallState();
  // The relay learns that the call runs from LiveKit's webhook, a moment
  // after this client is connected: one quiet retry covers that window
  // (Task 15 review, B1).
  const NOT_RUNNING_RETRY_MS = 1500;
  // Closing the dialog cancels a pending retry: no link may appear after
  // the user walked away. Plain lets: bookkeeping, never rendered.
  let destroyed = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let retryTimer;
  /** @type {(() => void) | null} */
  let cancelRetry = null;
  onDestroy(() => {
    destroyed = true;
    clearTimeout(retryTimer);
    cancelRetry?.();
  });
  /** @returns {Promise<boolean>} false when the dialog closed meanwhile */
  function waitForRetry() {
    return new Promise((resolve) => {
      cancelRetry = () => resolve(false);
      retryTimer = setTimeout(() => resolve(!destroyed), NOT_RUNNING_RETRY_MS);
    });
  }

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

  /** @param {unknown} err @returns {string} */
  function failureText(err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (reason === 'nip44-unsupported') return m.groups_call_invite_nip44();
    // The relay only mints passes for a call it sees running (39004 has a
    // participant) — while the LiveKit handshake is still going it answers
    // "blocked: no call is running" (QA 2026-10-02 B1).
    if (/no call is running/i.test(reason)) return m.groups_call_invite_not_running();
    return m.groups_call_invite_failed({ reason });
  }

  /** @param {unknown} err */
  function failure(err) {
    showToast(failureText(err), 'error');
  }

  // A refused "Link erstellen" is said IN the dialog: a toast under the
  // modal went unnoticed and the click looked like it did nothing (QA B1).
  /** @type {string | null} */
  let createError = $state(null);

  /** @param {unknown} err */
  function isNotRunning(err) {
    return /no call is running/i.test(err instanceof Error ? err.message : String(err));
  }

  async function createOnce() {
    return createCallLink(relay(), pointer, user, location.origin, { title: linkTitle });
  }

  async function create() {
    if (creating) return;
    creating = true;
    createError = null;
    try {
      let created;
      try {
        created = await createOnce();
      } catch (err) {
        if (!isNotRunning(err) || !call.connected) throw err;
        if (!(await waitForRetry())) return;
        created = await createOnce();
      }
      const { url, event } = created;
      latestUrl = url;
      linkTitle = '';
      rows = [{ pass: event, url }, ...rows];
    } catch (err) {
      console.warn('call links: create failed', err);
      createError = failureText(err);
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

  // "Zurückziehen" removes everyone who joined with the link: ask first
  // (QA round 2 C-new-2).
  /** @type {any} */
  let confirmPass = $state.raw(null);
  function confirmRevoke() {
    const pass = confirmPass;
    confirmPass = null;
    if (pass) revoke(pass);
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
    {/if}
    <!-- The name field stays after a create: a second link needs no reopen
      (QA round 2 K-new-4). -->
    <input
      class="input-bordered input mt-4 w-full"
      type="text"
      maxlength={TITLE_MAX_CHARS}
      placeholder={m.groups_call_invite_title_placeholder()}
      aria-label={m.groups_call_invite_title_placeholder()}
      bind:value={linkTitle}
      disabled={creating}
      onkeydown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          create();
        }
      }}
      data-testid="call-invite-title"
    />
    <button
      class="btn mt-2 {latestUrl ? '' : 'btn-primary'}"
      onclick={create}
      disabled={creating}
      data-testid="call-invite-create"
    >
      {#if creating}<span class="loading loading-sm loading-spinner"></span>{/if}
      {m.groups_call_invite_create()}
    </button>
    {#if createError}
      <p class="mt-2 text-sm text-error" role="alert" data-testid="call-invite-create-error">
        {createError}
      </p>
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
        <!-- An earlier call's links are gone with that call (C-new-4). -->
        <p class="mt-1 text-xs text-base-content/60">{m.groups_call_invite_scope_hint()}</p>
      {/if}
    {:else}
      <ul class="mt-2 flex flex-col gap-2">
        {#each rows as row (row.pass.id)}
          {@const rowTitle = passTitle(row.pass)}
          <li class="flex items-center gap-2 text-sm" data-testid="call-invite-pass">
            <span class="min-w-0 flex-1">
              <!-- The title is the user's own text (selectable); "created
                <time>" and "by someone else" after it are a label. A bare
                clock time said nothing (laoc, 2026-10-03), so an untitled
                link is called "Invite link". -->
              {#if rowTitle}
                <span class="font-medium break-words" data-testid="call-invite-pass-title"
                  >{rowTitle}</span
                >
              {:else}
                <span
                  class="cursor-default font-medium select-none"
                  data-testid="call-invite-pass-untitled">{m.groups_call_invite_untitled()}</span
                >
              {/if}
              <span class="cursor-default select-none" data-testid="call-invite-pass-meta"
                >· {m.groups_call_invite_created_at({
                  time: formatTimeOfDay(row.pass.created_at)
                })}
                {#if row.pass.pubkey !== user.pubkey}· {m.groups_call_invite_by_other()}{/if}</span
              >
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
                onclick={() => {
                  if (!revoking.has(row.pass.id)) confirmPass = row.pass;
                }}
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

{#if confirmPass}
  <div
    class="modal-open modal"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="call-invite-revoke-title"
    data-testid="call-invite-revoke-dialog"
  >
    <div class="modal-box max-w-sm">
      <h3 id="call-invite-revoke-title" class="text-lg font-bold">
        {m.groups_call_invite_revoke_confirm_title()}
      </h3>
      <p class="mt-2 text-sm text-base-content/70">{m.groups_call_invite_revoke_confirm_text()}</p>
      <div class="modal-action">
        <button
          class="btn btn-ghost"
          onclick={() => (confirmPass = null)}
          data-testid="call-invite-revoke-cancel"
        >
          {m.common_cancel()}
        </button>
        <button
          class="btn btn-error"
          onclick={confirmRevoke}
          data-testid="call-invite-revoke-confirm"
        >
          {m.groups_call_invite_revoke()}
        </button>
      </div>
    </div>
    <button
      class="modal-backdrop"
      aria-label={m.common_cancel()}
      onclick={() => (confirmPass = null)}
    ></button>
  </div>
{/if}
