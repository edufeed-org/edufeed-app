// Display labels for NIP-29 role tokens. Roles in a kind 39001 are
// relay-assigned strings — groups.0xchat.com hands the group creator the
// literal role "king", which read like debug output in the members list
// (journey-test bug #14). Well-known tokens get a localized label; custom
// role names a community defined itself pass through verbatim, because
// role-gated section tiers match them literally and renaming them in one
// surface but not the tier editor would be worse than showing them raw.
import * as m from '$lib/paraglide/messages';

/**
 * @param {string} role
 * @returns {string}
 */
export function roleLabel(role) {
  switch (role?.toLowerCase?.()) {
    case 'king':
      return m.groups_role_king();
    case 'admin':
      return m.groups_role_admin();
    default:
      return role;
  }
}
