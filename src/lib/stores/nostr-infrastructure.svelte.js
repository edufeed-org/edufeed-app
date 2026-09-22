/**
 * Nostr Infrastructure - Core stores and pool
 * Relay configuration is managed via runtimeConfig (from .env)
 */
import { EventStore, DeleteManager } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
// Side-effect: registers CommentsModel, casts, and other mixins on EventStore
import 'applesauce-common';

// The DeleteManager is created here and exposed on the store so the persistent
// event cache can mirror NIP-09 deletions into IDB: kind 5 events go straight
// to the manager and never appear on `insert$`, and the store keeps its own
// reference private. Attached as a property (not a separate export) so the
// many tests that mock this module with a bare `eventStore` keep working.
const deleteManager = new DeleteManager();
export const eventStore = Object.assign(new EventStore({ deleteManager }), { deleteManager });
// v6: eoseTimeout was removed. Per-request completion is handled by
// group.request()'s default complete strategy (first EOSE + 5s grace, or all
// EOSE) plus the explicit timeout passed by timedPool (loaders/base.js).
export const pool = new RelayPool();
