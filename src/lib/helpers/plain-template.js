/**
 * Plain (non-reactive) copy of a Nostr event template's tags. Community
 * templates are built from a kind-10222 that lives in Svelte component
 * `$state`, so its tag entries — reused verbatim by the flip/attach/
 * access-tier/basics builders — are deep reactive proxies. In-process signers
 * (nsec) sign those fine, but a NIP-07 extension signer serialises the template
 * through `window.postMessage`, and structuredClone throws `DataCloneError` on
 * a Svelte proxy. Rebuilding each tag as a plain string array (elements are
 * always strings) de-proxies it; nothing else in such a template is a proxy
 * (kind/created_at are numbers, content a string).
 *
 * Shared so every direct `signer.signEvent(...)` call site on a community
 * template de-proxies through one mechanism instead of a private copy.
 * @param {any} template
 */
export function plainTemplate(template) {
  return {
    ...template,
    tags: Array.isArray(template?.tags)
      ? template.tags.map((/** @type {string[]} */ tag) => [...tag])
      : template?.tags
  };
}
