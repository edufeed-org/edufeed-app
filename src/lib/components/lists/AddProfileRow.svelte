<!--
  AddProfileRow — Input row for adding a pubkey to a people list
  (follow set 30000 / starter pack 39089).

  Thin wrapper around ContactSearchInput with combobox flags enabled:
  the dropdown surfaces contact-name matches (excluded entries visible
  but disabled with an "Already added" badge) plus a synthetic row when
  the input parses as an npub/hex pubkey.

  Both selection paths fan into `onadd(pubkey)` with a hex pubkey.
-->
<script>
  import ContactSearchInput from '$lib/components/shared/ContactSearchInput.svelte';
  import * as m from '$lib/paraglide/messages';

  /**
   * @type {{
   *   onadd: (pubkey: string) => void | Promise<void>,
   *   excludePubkeys?: string[],
   *   disabled?: boolean
   * }}
   */
  let { onadd, excludePubkeys = [], disabled = false } = $props();

  let value = $state('');

  /** @param {{ pubkey: string }} contact */
  function handleSelect(contact) {
    onadd(contact.pubkey);
    value = '';
  }

  /** @param {string} hex */
  function handleRawPubkey(hex) {
    onadd(hex);
    value = '';
  }
</script>

<div class="rounded-lg border border-base-300 bg-base-200/40 p-3">
  <ContactSearchInput
    bind:value
    placeholder={m.list_detail_add_profile_search_placeholder()}
    exclude={excludePubkeys}
    showExcluded
    acceptPubkeyInput
    excludedLabel={m.list_detail_add_profile_already_added()}
    addPubkeyLabel={m.list_detail_add_profile_add_pubkey()}
    onselect={handleSelect}
    onrawpubkey={handleRawPubkey}
    {disabled}
  />
</div>
