/**
 * Write-action gating for read-only (npub) accounts.
 *
 * UX decision (spec 2026-07-16): write CTAs stay VISIBLE for readonly
 * accounts; activating one shows an upgrade prompt instead of doing nothing.
 * Anonymous users (no account) are NOT toasted here — those flows keep their
 * existing "please log in" behavior.
 */
import { showToast } from '$lib/helpers/toast.js';
import * as m from '$lib/paraglide/messages';

/**
 * Whether this account can produce signatures.
 * @param {{ type?: string } | null | undefined} account
 * @returns {boolean}
 */
export function canSign(account) {
  return !!account && account.type !== 'readonly';
}

/**
 * Guard for write-action entry points. Shows the read-only upgrade toast when
 * the account is readonly. Returns true when the action may proceed.
 * @param {{ type?: string } | null | undefined} account
 * @returns {boolean}
 */
export function requireSigningOrToast(account) {
  if (canSign(account)) return true;
  if (account) showToast(m.readonly_sign_prompt(), 'warning');
  return false;
}
