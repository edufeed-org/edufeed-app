/**
 * Nostr Infrastructure - Core stores and pool
 * Relay configuration is managed via runtimeConfig (from .env)
 */
import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
// Side-effect: registers CommentsModel, casts, and other mixins on EventStore
import 'applesauce-common';

export const eventStore = new EventStore();
export const pool = new RelayPool({ eoseTimeout: 3_000 });
