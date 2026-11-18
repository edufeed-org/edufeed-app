import { DeleteManager } from 'applesauce-core/event-store';

/**
 * applesauce's DeleteManager with one fix: per address it keeps the NEWEST
 * deletion time. Upstream (applesauce-core 7.0.3) keeps the last one added,
 * so an older kind 5 that arrives after a newer one (relays answer in any
 * order) pulls "deleted until" back, and a copy published between the two
 * deletions re-enters the store as live.
 * shortcut: overrides upstream internals (`deletedIdentifiers`); drop this
 * class once applesauce keeps the max itself.
 */
export class LatestDeleteManager extends DeleteManager {
  /** @param {import('nostr-tools').NostrEvent} deleteEvent */
  add(deleteEvent) {
    const before = new Map(this.deletedIdentifiers.get(deleteEvent.pubkey) ?? []);
    const notifications = super.add(deleteEvent);
    const after = this.deletedIdentifiers.get(deleteEvent.pubkey);
    for (const [key, until] of before) {
      if (after && until > (after.get(key) ?? 0)) after.set(key, until);
    }
    return notifications;
  }
}
