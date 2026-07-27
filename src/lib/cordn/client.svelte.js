/**
 * Cordn groups spike orchestrator. One instance per logged-in account; owns
 * one coordinator RPC per configured coordinator, MLS group states, and
 * IndexedDB persistence. Groups, key packages, and welcomes are scoped to the
 * coordinator they live on (cordn-web's "coordinators are the operational
 * boundary" model). Poll-based sync (bounded fetch); CEP-41 live streams are
 * deferred to a real integration.
 *
 * Browser-only (dynamic ts-mls/ContextVM imports happen in $lib/cordn modules);
 * only mount from ssr=false routes.
 */
import { buildEnvelope, validateEnvelope, CORDN_CHAT_KIND } from './envelope.js';
import { sealPayload, unsealPayload } from './sealed-payload.js';
import { CordnCoordinatorRpc } from './coordinator-rpc.js';
import { CordnStorage } from './storage.js';
import {
  addMember,
  createChatMessage,
  createInitialGroupState,
  decodeKeyPackagePair,
  decodeStateBase64,
  deriveGroupPayloadKey,
  encodeStateBase64,
  generateChatKeyPackage,
  getGid,
  joinFromWelcome,
  listMemberPubkeys,
  parseConsumedKeyPackage,
  processOpaqueMessage
} from './mls.js';

const KEY_PACKAGES_KEY = 'keyPackages';
const GROUPS_KEY = 'groups';
const POLL_INTERVAL_MS = 3000;

/** @typedef {{cursor: number, pubkey: string, content: string, at: number}} CordnChatMessage */
/** @typedef {{gid: string, name: string, coordinatorPubkey: string, members: string[], fetchCursor: number, messages: CordnChatMessage[]}} CordnGroupView */
/** @typedef {CordnGroupView & {stateBase64: string}} StoredCordnGroup */
/** @typedef {{coordinatorPubkey: string, keyPackageRef: string, keyPackageBase64: string, privateKeyPackageBase64: string}} StoredKeyPackage */
/** @typedef {{coordinatorPubkey: string, kp_ref: string, welcome_64: string, at: number, after?: number}} TaggedWelcome */

export class CordnGroupsClient {
  /** @type {CordnGroupView[]} */
  groups = $state.raw([]);
  /** @type {TaggedWelcome[]} */
  welcomes = $state.raw([]);
  status = $state('idle');
  error = $state('');
  keyPackageRef = $state('');

  /**
   * @param {object} params
   * @param {string} params.pubkey - active account hex pubkey
   * @param {import('@contextvm/sdk').NostrSigner} params.signer - active account signer
   * @param {{coordinatorPubkeys: string[], relays: string[]}} params.config
   */
  constructor({ pubkey, signer, config }) {
    this.pubkey = pubkey;
    this.coordinatorPubkeys = config.coordinatorPubkeys;
    /** @type {Map<string, CordnCoordinatorRpc>} coordinatorPubkey -> RPC (non-reactive internals) */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Map on purpose: never rendered
    this.rpcs = new Map(
      config.coordinatorPubkeys.map((serverPubkey) => [
        serverPubkey,
        new CordnCoordinatorRpc({ serverPubkey, relays: config.relays, signer })
      ])
    );
    this.storage = new CordnStorage(pubkey);
    /** @type {Map<string, import('ts-mls').ClientState>} gid -> live MLS ClientState (non-reactive internals) */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Map on purpose: never rendered, proxies break MLS state objects
    this.states = new Map();
    /** posted ciphertexts we must not re-process when they echo back */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- plain Set on purpose: internal dedupe, not UI state
    this.postedCiphertexts = new Set();
    /** @type {ReturnType<typeof setInterval> | undefined} */
    this.pollTimer = undefined;
    this.stopped = false;
  }

  /** @param {string} coordinatorPubkey */
  #rpc(coordinatorPubkey) {
    const rpc = this.rpcs.get(coordinatorPubkey);
    if (!rpc) throw new Error(`Unknown coordinator ${coordinatorPubkey.slice(0, 8)}`);
    return rpc;
  }

  async init() {
    this.status = 'loading';
    try {
      const storedGroups = /** @type {StoredCordnGroup[]} */ (
        (await this.storage.get(GROUPS_KEY)) || []
      );
      for (const group of storedGroups) {
        // Migration: records stored before multi-coordinator support belong to
        // the (then only) default coordinator.
        group.coordinatorPubkey ??= this.coordinatorPubkeys[0];
        this.states.set(group.gid, decodeStateBase64(group.stateBase64));
      }
      this.groups = storedGroups.map(({ stateBase64: _stateBase64, ...view }) => view);
      await this.#ensureKeyPackages();
      this.status = 'ready';
      this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
      void this.poll();
      void this.refreshWelcomes();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      this.status = 'error';
    }
  }

  async destroy() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    await Promise.all([...this.rpcs.values()].map((rpc) => rpc.disconnect()));
    await this.storage.close();
  }

  /** @returns {Promise<StoredKeyPackage[]>} */
  async #loadKeyPackages() {
    const records = /** @type {StoredKeyPackage[]} */ (
      (await this.storage.get(KEY_PACKAGES_KEY)) || []
    );
    for (const record of records) record.coordinatorPubkey ??= this.coordinatorPubkeys[0];
    return records;
  }

  /**
   * Ensure one published key package per configured coordinator. Coordinators
   * that fail (offline, unreachable) are skipped with a surfaced error so the
   * others keep working.
   */
  async #ensureKeyPackages() {
    let records = await this.#loadKeyPackages();
    for (const coordinatorPubkey of this.coordinatorPubkeys) {
      if (records.some((entry) => entry.coordinatorPubkey === coordinatorPubkey)) continue;
      try {
        const generated = await generateChatKeyPackage(this.pubkey);
        await this.#rpc(coordinatorPubkey).publishKeyPackage({
          kp_ref: generated.keyPackageRef,
          kp_64: generated.keyPackageBase64
        });
        records = [...records, { coordinatorPubkey, ...generated }];
      } catch (error) {
        this.error = `KeyPackage für ${coordinatorPubkey.slice(0, 8)}… fehlgeschlagen: ${error instanceof Error ? error.message : error}`;
      }
    }
    await this.storage.set(KEY_PACKAGES_KEY, records);
    this.keyPackageRef = records[0]?.keyPackageRef ?? '';
    if (records.length === 0) throw new Error('Kein Koordinator erreichbar');
  }

  async #persistGroups() {
    await this.storage.set(
      GROUPS_KEY,
      this.groups.map((group) => ({
        ...group,
        stateBase64: encodeStateBase64(this.#state(group.gid))
      }))
    );
  }

  /** @param {string} gid */
  #state(gid) {
    const state = this.states.get(gid);
    if (!state) throw new Error(`Missing MLS state for group ${gid}`);
    return state;
  }

  /**
   * Replace one group view immutably (triggers $state.raw reactivity).
   * @param {string} gid
   * @param {Partial<CordnGroupView>} patch
   */
  #updateGroup(gid, patch) {
    this.groups = this.groups.map((group) => (group.gid === gid ? { ...group, ...patch } : group));
  }

  /**
   * @param {string} name
   * @param {string} [coordinatorPubkey] - defaults to the first configured coordinator
   */
  async createGroup(name, coordinatorPubkey = this.coordinatorPubkeys[0]) {
    this.#rpc(coordinatorPubkey); // validate before doing MLS work
    const records = await this.#loadKeyPackages();
    const record = records.find((entry) => entry.coordinatorPubkey === coordinatorPubkey);
    if (!record) throw new Error('Kein KeyPackage für diesen Koordinator');
    const pair = decodeKeyPackagePair(record);
    const state = await createInitialGroupState(pair);
    const gid = getGid(state);
    this.states.set(gid, state);
    this.groups = [
      ...this.groups,
      {
        gid,
        name,
        coordinatorPubkey,
        members: listMemberPubkeys(state),
        fetchCursor: 0,
        messages: []
      }
    ];
    await this.#persistGroups();
    return gid;
  }

  /**
   * Add a member by stable pubkey (or kp_ref) on the group's coordinator.
   * Seals the commit under the pre-commit epoch (spec/03 §5), posts it, then
   * stores the welcome with the commit's cursor as the invitee's backfill hint.
   *
   * @param {string} gid
   * @param {string} pubkeyOrRef
   */
  async addMemberToGroup(gid, pubkeyOrRef) {
    const state = this.#state(gid);
    const rpc = this.#rpc(this.#group(gid).coordinatorPubkey);
    const { keyPackage: consumed } = await rpc.consumeKeyPackage({ id: pubkeyOrRef });
    if (!consumed) throw new Error('Kein KeyPackage für diese Person auf dem Koordinator');
    const memberKeyPackage = parseConsumedKeyPackage(consumed);
    const result = await addMember({ state, memberKeyPackage });
    const preCommitKey = await deriveGroupPayloadKey(state);
    const sealed = sealPayload({
      key: preCommitKey,
      plaintext: Uint8Array.from(atob(result.commitMessageBase64), (c) => c.charCodeAt(0))
    });
    this.postedCiphertexts.add(sealed);
    const posted = await rpc.postGroupMessage({ gid, msg_64: sealed });
    this.states.set(gid, result.newState);
    this.#updateGroup(gid, {
      members: listMemberPubkeys(result.newState),
      fetchCursor: Math.max(this.#group(gid).fetchCursor, posted.cursor)
    });
    await rpc.storeWelcome({
      target_pk: consumed.pk,
      kp_ref: consumed.kp_ref,
      welcome_64: result.welcomeBase64,
      after: posted.cursor
    });
    await this.#persistGroups();
  }

  /** Fetch pending welcomes from every reachable coordinator. */
  async refreshWelcomes() {
    const results = await Promise.all(
      this.coordinatorPubkeys.map(async (coordinatorPubkey) => {
        try {
          const { welcomes } = await this.#rpc(coordinatorPubkey).fetchPendingWelcomes();
          return welcomes.map((welcome) => ({ coordinatorPubkey, ...welcome }));
        } catch (error) {
          this.error = `Einladungen von ${coordinatorPubkey.slice(0, 8)}…: ${error instanceof Error ? error.message : error}`;
          return [];
        }
      })
    );
    if (!this.stopped) this.welcomes = results.flat();
  }

  /** @param {TaggedWelcome} welcome */
  async acceptWelcome(welcome) {
    const records = await this.#loadKeyPackages();
    const record = records.find(
      (entry) =>
        entry.keyPackageRef === welcome.kp_ref &&
        entry.coordinatorPubkey === welcome.coordinatorPubkey
    );
    if (!record) throw new Error('Lokales KeyPackage für diese Einladung fehlt');
    const pair = decodeKeyPackagePair(record);
    const state = await joinFromWelcome({ welcomeBase64: welcome.welcome_64, ...pair });
    const gid = getGid(state);
    this.states.set(gid, state);
    this.groups = [
      ...this.groups,
      {
        gid,
        name: `Gruppe ${gid.slice(0, 8)}`,
        coordinatorPubkey: welcome.coordinatorPubkey,
        members: listMemberPubkeys(state),
        fetchCursor: welcome.after ?? 0,
        messages: []
      }
    ];
    await this.#persistGroups();
    // Ack consumption so the coordinator retires the welcome, and rotate this
    // coordinator's key package (the accepted one is used up).
    const rpc = this.#rpc(welcome.coordinatorPubkey);
    await rpc.fetchPendingWelcomes({ consumed: [{ kp_ref: welcome.kp_ref, at: welcome.at }] });
    await this.storage.set(
      KEY_PACKAGES_KEY,
      records.filter((entry) => entry !== record)
    );
    await this.#ensureKeyPackages();
    this.welcomes = this.welcomes.filter(
      (w) => !(w.kp_ref === welcome.kp_ref && w.coordinatorPubkey === welcome.coordinatorPubkey)
    );
    return gid;
  }

  /**
   * @param {string} gid
   * @param {string} text
   */
  async send(gid, text) {
    const state = this.#state(gid);
    const rpc = this.#rpc(this.#group(gid).coordinatorPubkey);
    const envelope = buildEnvelope({ pubkey: this.pubkey, kind: CORDN_CHAT_KIND, content: text });
    const { newState, opaqueMessageBase64 } = await createChatMessage({
      state,
      envelopeJson: JSON.stringify(envelope),
      senderPubkey: this.pubkey
    });
    const key = await deriveGroupPayloadKey(state);
    const sealed = sealPayload({
      key,
      plaintext: Uint8Array.from(atob(opaqueMessageBase64), (c) => c.charCodeAt(0))
    });
    this.postedCiphertexts.add(sealed);
    const posted = await rpc.postGroupMessage({ gid, msg_64: sealed });
    this.states.set(gid, newState);
    const group = this.#group(gid);
    this.#updateGroup(gid, {
      fetchCursor: Math.max(group.fetchCursor, posted.cursor),
      messages: [
        ...group.messages,
        { cursor: posted.cursor, pubkey: this.pubkey, content: text, at: posted.at }
      ]
    });
    await this.#persistGroups();
  }

  /** @param {string} gid */
  #group(gid) {
    const group = this.groups.find((entry) => entry.gid === gid);
    if (!group) throw new Error(`Unknown group ${gid}`);
    return group;
  }

  async poll() {
    if (this.stopped || this.groups.length === 0) return;
    /** @type {Array<{cursor: number, gid: string, msg_64: string, at: number}>} */
    const messages = [];
    for (const coordinatorPubkey of this.coordinatorPubkeys) {
      const coordinatorGroups = this.groups.filter(
        (group) => group.coordinatorPubkey === coordinatorPubkey
      );
      if (coordinatorGroups.length === 0) continue;
      try {
        const response = await this.#rpc(coordinatorPubkey).fetchManyGroupMessages({
          groups: coordinatorGroups.map(({ gid, fetchCursor }) => ({
            gid,
            ...(fetchCursor > 0 ? { after: fetchCursor } : {})
          }))
        });
        messages.push(...response.messages);
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    }
    let dirty = false;
    for (const message of messages.sort((a, b) => a.cursor - b.cursor)) {
      if (this.stopped) return;
      dirty = (await this.#ingest(message)) || dirty;
    }
    if (dirty) await this.#persistGroups();
  }

  /**
   * @param {{cursor: number, gid: string, msg_64: string, at: number}} message
   * @returns {Promise<boolean>} whether group state changed
   */
  async #ingest(message) {
    const group = this.groups.find((entry) => entry.gid === message.gid);
    if (!group || message.cursor <= group.fetchCursor) return false;
    if (this.postedCiphertexts.has(message.msg_64)) {
      this.#updateGroup(message.gid, { fetchCursor: message.cursor });
      return true;
    }
    const state = this.#state(message.gid);
    try {
      const key = await deriveGroupPayloadKey(state);
      const opaque = unsealPayload({ key, sealedBase64: message.msg_64 });
      let base64 = '';
      for (const byte of opaque) base64 += String.fromCharCode(byte);
      const processed = await processOpaqueMessage({
        state,
        opaqueMessageBase64: btoa(base64)
      });
      this.states.set(message.gid, processed.newState);
      if (processed.kind === 'application') {
        const envelope = JSON.parse(processed.envelopeJson);
        const verdict = validateEnvelope(envelope, processed.senderPubkey);
        if (verdict.valid) {
          this.#updateGroup(message.gid, {
            fetchCursor: message.cursor,
            messages: [
              ...this.#group(message.gid).messages,
              {
                cursor: message.cursor,
                pubkey: envelope.pubkey,
                content: envelope.content,
                at: message.at
              }
            ]
          });
          return true;
        }
      }
      this.#updateGroup(message.gid, {
        fetchCursor: message.cursor,
        members: listMemberPubkeys(processed.newState)
      });
    } catch (error) {
      // Undecryptable backlog (e.g. pre-join epochs) — skip forward, keep note.
      this.error = `Nachricht ${message.cursor} übersprungen: ${error instanceof Error ? error.message : error}`;
      this.#updateGroup(message.gid, { fetchCursor: message.cursor });
    }
    return true;
  }
}
