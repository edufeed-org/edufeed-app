/**
 * Nostr Infrastructure - Core stores and pool
 * Relay configuration is managed via runtimeConfig (from .env)
 */
import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
// Side-effect: registers CommentsModel, casts, and other mixins on EventStore
import 'applesauce-common';

export const eventStore = new EventStore();
// v6: eoseTimeout was removed. Per-request completion is handled by
// group.request()'s default complete strategy (first EOSE + 5s grace, or all
// EOSE) plus the explicit timeout passed by timedPool (loaders/base.js).
export const pool = new RelayPool();
