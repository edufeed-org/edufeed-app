// What the moderated-community wizard seeds the NIP-29 root group's 39000
// with: name, about and picture. Sources, in order: what the new-keypair flow
// collected into userData, else the creator's cached kind 0, else the literal
// 'Community'. Pure and null-safe — issue wc4x0lnp: the wizard called
// applesauce's getProfileContent(undefined) when the creator had no cached
// kind 0 (every fresh e2e key, and any real account that never published a
// profile or whose kind 0 hadn't loaded yet). getOrComputeCachedValue does
// Reflect.has(event, symbol) on that undefined, so provisioning aborted with
// "Reflect.has called on non-object" before the first relay round-trip.
import { getDisplayName, getProfileContent } from 'applesauce-core/helpers';

/**
 * @param {{name?: string, about?: string, picture?: string} | null | undefined} userData
 * @param {any} cachedProfile kind-0 event from the EventStore, or undefined
 * @returns {{name: string, about: string | undefined, picture: string | undefined}}
 */
export function rootGroupSeed(userData, cachedProfile) {
  const content = cachedProfile ? getProfileContent(cachedProfile) : undefined;
  const cachedName = cachedProfile ? getDisplayName(cachedProfile) : '';
  return {
    name: userData?.name?.trim() || cachedName || 'Community',
    about: userData?.about?.trim() || content?.about || undefined,
    picture: userData?.picture?.trim() || content?.picture || undefined
  };
}
