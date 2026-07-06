/**
 * Shared type definitions for layout-level context handoffs.
 */

/**
 * Data exposed by `c/[pubkey]/+layout.svelte` so the root layout can mount
 * `ContentNavSidebar` in the chrome row without lifting community-data
 * loading up to the root.
 *
 * @typedef {{
 *   selectedContentType: string,
 *   onContentTypeSelect: (type: string) => void,
 *   communitySelected: boolean,
 *   communityProfile: any,
 *   communityPubkey: string,
 *   restrictedTabs: Set<string>,
 *   accessibleTabs: Set<string>,
 *   communityEvent: any
 * }} ContentNavData
 */

// Export empty object to make this a module.
export {};
