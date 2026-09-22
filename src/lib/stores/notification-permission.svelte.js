/**
 * The one opt-in flow for OS-level notifications, shared by the settings
 * page and the Concord area settings: flip the per-device flag, asking the
 * browser for permission on the way in. Kept apart from the toast service so
 * UI chrome can import it without pulling the DM and inbox services along.
 */
import { appSettings } from '$lib/stores/app-settings.svelte.js';
import { notificationsSupported } from '$lib/helpers/system-notifications.js';

/** @typedef {'on' | 'off' | 'unsupported' | 'denied' | 'default'} ToggleResult */

/** @returns {boolean} */
export function getSystemNotificationsEnabled() {
  return appSettings.systemNotificationsEnabled;
}

/**
 * Whether the browser has blocked notifications for this origin. The browser
 * offers no change event worth polling — callers re-read after a toggle.
 * @returns {boolean}
 */
export function isNotificationPermissionDenied() {
  return notificationsSupported() && Notification.permission === 'denied';
}

/**
 * Toggle the opt-in. Enabling requests the browser permission first and
 * only flips the flag when it was granted, so the flag never claims more
 * than the browser allows.
 * @returns {Promise<ToggleResult>}
 */
export async function toggleSystemNotifications() {
  if (appSettings.systemNotificationsEnabled) {
    appSettings.systemNotificationsEnabled = false;
    return 'off';
  }
  if (!notificationsSupported()) return 'unsupported';
  let permission = Notification.permission;
  if (permission !== 'granted') permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  appSettings.systemNotificationsEnabled = true;
  return 'on';
}
