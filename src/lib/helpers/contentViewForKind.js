/**
 * Map a Nostr event kind to the community layout's content-view id
 * (matches the `?view=` query param and sidebar tab id in
 * `src/routes/c/[pubkey]/+layout.svelte`).
 *
 * Used by the polymorphic `[nevent=nevent]` route to keep the sidebar
 * on the originating section (forum / polls / …) when navigating to a
 * thread or poll detail view.
 *
 * Returns `undefined` for kinds that have no sidebar tab so callers can
 * leave the URL untouched.
 *
 * @param {number | null | undefined} kind
 * @returns {string | undefined}
 */
export function getContentViewForKind(kind) {
  switch (kind) {
    case 1:
    case 11:
      return 'forum';
    case 1068:
      return 'polls';
    default:
      return undefined;
  }
}
