/**
 * Reactive stand-in for `$app/state` in component tests: reassign
 * `page.url` to simulate a navigation (path or hash change).
 */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- test double, the url is replaced whole
export const page = $state({ url: new URL('http://localhost/') });
