/**
 * Follow / unfollow a user on the active account's kind 3 contact list.
 * Shared by the profile page and the profile hover card so both surfaces
 * run the exact same action + toast behaviour.
 */
import { FollowUser, UnfollowUser } from 'applesauce-actions/actions';
import { actionRunner } from '$lib/stores/action-runner.svelte.js';
import { showToast } from '$lib/helpers/toast';
import * as m from '$lib/paraglide/messages.js';

/**
 * @param {string} pubkey - hex pubkey to follow / unfollow
 * @param {boolean} isFollowing - current state (true = unfollow)
 * @returns {Promise<boolean>} true when the action succeeded
 */
export async function toggleFollow(pubkey, isFollowing) {
  try {
    if (isFollowing) {
      await actionRunner.run(UnfollowUser, pubkey);
      showToast(m.profile_unfollow_success(), 'success');
    } else {
      await actionRunner.run(FollowUser, pubkey);
      showToast(m.profile_follow_success(), 'success');
    }
    return true;
  } catch (err) {
    console.error('Follow action failed:', err);
    showToast(m.profile_follow_error(), 'error');
    return false;
  }
}
