/**
 * Route matcher for resource-form variant ids.
 *
 * Validates against the static `ALL_VARIANTS` registry rather than the
 * deployment-enabled list. Rationale: SvelteKit runs matchers server-side
 * during route resolution, before any `load()` function and before the
 * client has fetched `/api/config`. Checking `getEnabledVariants()` here
 * would read the pre-config defaults (just `['amb']`) and falsely 404 any
 * direct visit to an otherwise-valid variant URL like `/create/resource/ekw`.
 *
 * Disabled-but-registered variants are instead redirected to the default
 * variant inside `[variant=resourceVariant]/+page.svelte` once
 * `configReady` resolves.
 *
 * @param {string} param - The route parameter to validate
 * @returns {boolean} True if the parameter is a registered variant id
 */
import { ALL_VARIANTS } from '$lib/config/resource-form-variants.js';

export function match(param) {
  if (!param) return false;
  return ALL_VARIANTS.some((v) => v.id === param);
}
