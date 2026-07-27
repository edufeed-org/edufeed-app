/**
 * ContextVM RPC client for a Cordn coordinator (spec/00). Two transports:
 * the stable (identity) signer is used only for identity-bound calls
 * (KeyPackage publish/consume, Welcome store/fetch); message traffic goes
 * through a random ephemeral signer so the coordinator cannot tie posts and
 * fetches to the user's npub.
 *
 * Trimmed adaptation of cordn-web's coordinatorClient.ts (MIT, © 2026 the
 * Cordn contributors). Browser-only — import via $lib/cordn.
 */
import { Client } from '@contextvm/mcp-sdk/client';
import {
  ApplesauceRelayPool,
  GiftWrapMode,
  NostrClientTransport,
  PrivateKeySigner
} from '@contextvm/sdk';

const METHODS = {
  publishKeyPackage: 'kp_publish',
  listAvailableKeyPackages: 'kp_list',
  consumeKeyPackage: 'kp_take',
  fetchPendingWelcomes: 'welcome_take',
  storeWelcome: 'welcome_store',
  postGroupMessage: 'msg_post',
  fetchManyGroupMessages: 'msg_fetch_many'
};

export class CordnCoordinatorRpc {
  /**
   * @param {object} options
   * @param {string} options.serverPubkey - coordinator hex pubkey
   * @param {string[]} options.relays - ContextVM transport relays
   * @param {import('@contextvm/sdk').NostrSigner} options.signer - stable identity signer
   */
  constructor({ serverPubkey, relays, signer }) {
    /** @type {Omit<import('@contextvm/sdk').NostrTransportOptions, 'signer'>} */
    this.transportBase = {
      serverPubkey,
      relayHandler: new ApplesauceRelayPool(relays),
      logLevel: 'silent',
      isStateless: true,
      giftWrapMode: GiftWrapMode.EPHEMERAL,
      openStream: { enabled: true },
      oversizedTransfer: { enabled: true }
    };
    this.stableSigner = signer;
    /** @type {{client: Client, transport: NostrClientTransport, connected: Promise<void>} | null} */
    this.stable = null;
    /** @type {{client: Client, transport: NostrClientTransport, connected: Promise<void>} | null} */
    this.ephemeral = null;
  }

  /** @param {'stable' | 'ephemeral'} kind */
  #connection(kind) {
    if (!this[kind]) {
      const client = new Client({ name: `EdufeedCordnClient-${kind}`, version: '1.0.0' });
      const transport = new NostrClientTransport({
        ...this.transportBase,
        signer: kind === 'stable' ? this.stableSigner : new PrivateKeySigner()
      });
      this[kind] = { client, transport, connected: client.connect(transport) };
    }
    return this[kind];
  }

  /**
   * @param {'stable' | 'ephemeral'} transportKind
   * @param {string} name
   * @param {Record<string, unknown>} args
   * @returns {Promise<any>}
   */
  async #call(transportKind, name, args) {
    const { client, connected } = this.#connection(transportKind);
    await connected;
    const result = await client.callTool({ name, arguments: { ...args } }, undefined, {
      onprogress: () => undefined,
      resetTimeoutOnProgress: true
    });
    if (result.isError) {
      const content = /** @type {Array<{type: string, text?: string}>} */ (result.content ?? []);
      const message = content
        .filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('\n');
      throw new Error(message || 'Unknown coordinator error');
    }
    return result.structuredContent;
  }

  /** @param {{kp_ref: string, kp_64: string}} input */
  publishKeyPackage(input) {
    return this.#call('stable', METHODS.publishKeyPackage, input);
  }

  /** @returns {Promise<{keyPackages: Array<{pk: string, kp_ref: string, last_resort: boolean, at: number}>}>} */
  listAvailableKeyPackages() {
    return this.#call('ephemeral', METHODS.listAvailableKeyPackages, {});
  }

  /**
   * @param {{id: string}} input - stable pubkey or kp_ref
   * @returns {Promise<{keyPackage: {pk: string, kp_ref: string, event: import('nostr-tools').Event} | null}>}
   */
  consumeKeyPackage(input) {
    return this.#call('stable', METHODS.consumeKeyPackage, input);
  }

  /**
   * @param {{consumed?: Array<{kp_ref: string, at: number}>}} [input]
   * @returns {Promise<{welcomes: Array<{kp_ref: string, welcome_64: string, at: number, after?: number}>}>}
   */
  fetchPendingWelcomes(input = {}) {
    return this.#call('stable', METHODS.fetchPendingWelcomes, input);
  }

  /** @param {{target_pk: string, kp_ref: string, welcome_64: string, after?: number}} input */
  storeWelcome(input) {
    return this.#call('stable', METHODS.storeWelcome, input);
  }

  /**
   * @param {{gid: string, msg_64: string}} input
   * @returns {Promise<{cursor: number, gid: string, at: number}>}
   */
  postGroupMessage(input) {
    return this.#call('ephemeral', METHODS.postGroupMessage, input);
  }

  /**
   * @param {{groups: Array<{gid: string, after?: number}>}} input
   * @returns {Promise<{messages: Array<{cursor: number, gid: string, msg_64: string, at: number}>}>}
   */
  fetchManyGroupMessages(input) {
    return this.#call('ephemeral', METHODS.fetchManyGroupMessages, input);
  }

  async disconnect() {
    for (const connection of [this.stable, this.ephemeral]) {
      if (!connection) continue;
      await connection.connected.catch(() => undefined);
      await connection.transport.close().catch(() => undefined);
    }
    this.stable = null;
    this.ephemeral = null;
  }
}
