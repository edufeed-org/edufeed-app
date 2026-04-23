/**
 * Route matcher for resource-form variant ids.
 * Ensures the `/create/resource/[variant]` route only resolves for variant ids
 * that are enabled on this deployment (as configured via RESOURCE_FORM_VARIANTS).
 *
 * Falls back to the registry's default (`['amb']`) when runtime config hasn't
 * loaded yet, so the default route keeps resolving during early startup.
 *
 * @param {string} param - The route parameter to validate
 * @returns {boolean} True if the parameter is an enabled variant id
 */
import { getEnabledVariants } from '$lib/config/resource-form-variants.js';

export function match(param) {
  if (!param) return false;
  return getEnabledVariants().some((v) => v.id === param);
}
