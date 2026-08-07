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
import { findGroupMetadata } from './group-metadata.js';
import {
  buildChainRanges,
  parseConnectionString,
  parseTipEvent,
  planReconcile,
  unsealDocument
} from './multidevice-sync.js';
import { fetchBlossomText, fetchLatestTip } from './multidevice-net.js';
import {
  addMember,
  SiblingCommitSkippedError,
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
const MULTI_DEVICE_KEY = 'multiDevice';
const POLL_INTERVAL_MS = 3000;
/** Tip re-check every Nth message poll (~30s). */
const TIP_POLL_EVERY = 10;
/** cordn-web's default tip relays (multiDevice.svelte.ts). */
const DEFAULT_TIP_RELAYS = [
  'wss://relay.nostr.net',
  'wss://relay.ditto.pub',
  'wss://relay.primal.net'
];

/** @typedef {{cursor: number, pubkey: string, content: string, at: number}} CordnChatMessage */
/** @typedef {{gid: string, name: string, coordinatorPubkey: string, members: string[], adminPubkeys: string[], fetchCursor: number, messages: CordnChatMessage[], viaSync?: boolean}} CordnGroupView */
/** @typedef {{ephemeralPubkey: string, dTag: string, relays: string[], ephemeralPrivateKey: string, dek?: string, servers?: string[], lastDocAddressByGid?: Record<string, string>, lastMetaAddress?: string, historyRecoveredGids?: string[]}} MultiDeviceConfig */
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
  /** @type {{dTag: string, lastSyncAt: number} | undefined} */
  multiDevice = $state.raw(undefined);

  /**
   * @param {object} params
   * @param {string} params.pubkey - active account hex pubkey
   * @param {import('@contextvm/sdk').NostrSigner} params.signer - active account signer
   * @param {{coordinatorPubkeys: string[], relays: string[]}} params.config
   */
  constructor({ pubkey, signer, config }) {
    this.pubkey = pubkey;
    this.signer = signer;
    this.relays = config.relays;
    this.coordinatorPubkeys = config.coordinatorPubkeys;
    this.pollCount = 0;
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

  /**
   * RPC for a coordinator; created on demand for coordinators discovered via
   * multi-device sync (synced groups may live outside the configured list).
   * @param {string} coordinatorPubkey
   */
  #rpc(coordinatorPubkey) {
    let rpc = this.rpcs.get(coordinatorPubkey);
    if (!rpc) {
      rpc = new CordnCoordinatorRpc({
        serverPubkey: coordinatorPubkey,
        relays: this.relays,
        signer: this.signer
      });
      this.rpcs.set(coordinatorPubkey, rpc);
    }
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
        const state = decodeStateBase64(group.stateBase64);
        this.states.set(group.gid, state);
        group.adminPubkeys ??= findGroupMetadata(state)?.adminPubkeys ?? [];
      }
      this.groups = storedGroups.map(({ stateBase64: _stateBase64, ...view }) => view);
      const multiDeviceConfig = /** @type {MultiDeviceConfig | undefined} */ (
        await this.storage.get(MULTI_DEVICE_KEY)
      );
      if (multiDeviceConfig) {
        this.multiDevice = { dTag: multiDeviceConfig.dTag, lastSyncAt: 0 };
      }
      await this.#ensureKeyPackages();
      this.status = 'ready';
      this.pollTimer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
      void this.poll();
      void this.refreshWelcomes();
      if (multiDeviceConfig) {
        void this.syncFromTip().catch((error) => {
          this.error = `Geräte-Sync: ${error instanceof Error ? error.message : error}`;
        });
      }
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
        adminPubkeys: [],
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
    if (this.#group(gid).viaSync) {
      // Epoch-advancing commits on shared-leaf groups need the tip write side
      // (reconcile-before-commit + doc republish, §10.5) — not in the spike.
      throw new Error('Synchronisierte Gruppen werden in cordn.net verwaltet');
    }
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

  /**
   * Link this app as a device of the identity behind a cordn-web connection
   * string (multi-device §11): persist the tip locator + ephemeral key, then
   * pull the tip. Requires being logged in as the same identity — the tip's
   * inner event must decrypt and verify against our pubkey.
   *
   * @param {string} connectionString
   */
  async linkDevice(connectionString) {
    const parsed = parseConnectionString(connectionString);
    /** @type {MultiDeviceConfig} */
    const config = {
      ...parsed,
      relays: parsed.relays.length > 0 ? parsed.relays : DEFAULT_TIP_RELAYS,
      lastDocAddressByGid: {}
    };
    await this.storage.set(MULTI_DEVICE_KEY, config);
    this.multiDevice = { dTag: config.dTag, lastSyncAt: 0 };
    await this.syncFromTip();
  }

  /**
   * Fetch the latest tip and reconcile all advertised group documents into
   * local state (multi-device §8/§9): seed unknown groups, fast-forward when
   * the doc's MLS epoch is ahead, drop tombstoned groups. Never downgrades.
   */
  async syncFromTip() {
    const config = /** @type {MultiDeviceConfig | undefined} */ (
      await this.storage.get(MULTI_DEVICE_KEY)
    );
    if (!config) return;
    const tipEvent = await fetchLatestTip(config);
    if (!tipEvent) throw new Error('Kein Tip-Event auf den Relays gefunden');
    const tip = await parseTipEvent(tipEvent, {
      ownerPubkey: this.pubkey,
      nip44Decrypt: (pubkey, ciphertext) => {
        if (!this.signer.nip44) throw new Error('Signer unterstützt kein NIP-44');
        return this.signer.nip44.decrypt(pubkey, ciphertext);
      }
    });
    if (tip.dek) config.dek = tip.dek;
    if (tip.servers.length > 0) config.servers = tip.servers;
    if (!config.dek) throw new Error('Tip enthält keinen Dokumentenschlüssel');
    const dekHex = config.dek;
    const servers = config.servers ?? [];

    /** @type {Array<{gid: string, epoch: bigint, address: string, state: import('ts-mls').ClientState, doc: Record<string, any>}>} */
    const docs = [];
    for (const { address, gid } of tip.groupDocs) {
      if (config.lastDocAddressByGid?.[gid] === address && this.groups.some((g) => g.gid === gid)) {
        continue; // unchanged since last sync
      }
      const sealedText = await fetchBlossomText(servers, address);
      const doc = await unsealDocument({ sealedText, dekHex, expectedAddress: address });
      if (doc.type !== 'group' || typeof doc.clientState !== 'string') continue;
      const state = decodeStateBase64(doc.clientState);
      docs.push({ gid: doc.gid, epoch: BigInt(state.groupContext.epoch), address, state, doc });
    }

    /** @type {Array<{gid: string, epoch: number}>} */
    let tombstones = [];
    if (tip.metaDoc && config.lastMetaAddress !== tip.metaDoc) {
      const sealedText = await fetchBlossomText(servers, tip.metaDoc);
      const meta = await unsealDocument({ sealedText, dekHex, expectedAddress: tip.metaDoc });
      tombstones = Array.isArray(meta.removed) ? meta.removed : [];
      config.lastMetaAddress = tip.metaDoc;
    }

    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient local lookup, not UI state
    const byGid = new Map(docs.map((entry) => [entry.gid, entry]));
    const plan = planReconcile({
      localGroups: this.groups.map((group) => ({
        gid: group.gid,
        epoch: BigInt(this.states.get(group.gid)?.groupContext.epoch ?? 0)
      })),
      docs,
      tombstones
    });
    for (const step of plan) {
      const entry = byGid.get(step.gid);
      if ((step.action === 'seed' || step.action === 'fastForward') && entry) {
        this.#adoptSyncedGroup(entry, step.action);
        config.lastDocAddressByGid ??= {};
        config.lastDocAddressByGid[step.gid] = entry.address;
      } else if (step.action === 'drop') {
        this.groups = this.groups.filter((group) => group.gid !== step.gid);
        this.states.delete(step.gid);
        delete config.lastDocAddressByGid?.[step.gid];
      }
    }
    await this.#persistGroups();
    await this.storage.set(MULTI_DEVICE_KEY, config);
    this.multiDevice = { dTag: config.dTag, lastSyncAt: Date.now() };

    // §8.5 chained catch-up: recover decryptable history for synced groups,
    // once per group. Sequential + background — recovery is best-effort.
    void (async () => {
      for (const group of this.groups) {
        if (this.stopped || !group.viaSync) continue;
        if (config.historyRecoveredGids?.includes(group.gid)) continue;
        try {
          await this.#recoverHistory(group.gid, config);
        } catch (error) {
          this.error = `Verlauf für ${group.name}: ${error instanceof Error ? error.message : error}`;
        }
        config.historyRecoveredGids = [...(config.historyRecoveredGids ?? []), group.gid];
        await this.storage.set(MULTI_DEVICE_KEY, config);
      }
    })();
  }

  /**
   * Spec §8.5 — walk the group document `prev` chain to collect the oldest
   * (gen-0) ClientState per epoch, fetch the coordinator backlog in the
   * covered cursor window, and decrypt each half-open range with its epoch's
   * state. Messages older than the oldest retained document stay unreachable
   * (MLS forward secrecy). Never touches the live state.
   *
   * @param {string} gid
   * @param {MultiDeviceConfig} config
   */
  async #recoverHistory(gid, config) {
    const group = this.groups.find((entry) => entry.gid === gid);
    const startAddress = config.lastDocAddressByGid?.[gid];
    if (!group || !startAddress || !config.dek) return;
    const servers = config.servers ?? [];

    /** @type {Map<bigint, {cursor: number, state: import('ts-mls').ClientState}>} */
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient local lookup
    const byEpoch = new Map();
    /** @type {string | undefined} */
    let address = startAddress;
    for (let hop = 0; hop < 200 && address; hop++) {
      /** @type {Record<string, any>} */
      let doc;
      try {
        const sealedText = await fetchBlossomText(servers, address);
        doc = await unsealDocument({ sealedText, dekHex: config.dek, expectedAddress: address });
      } catch {
        break; // chain end, GC'd blob, or unreachable server — recover what we have
      }
      if (doc.type !== 'group' || doc.gid !== gid) break;
      const state = decodeStateBase64(doc.clientState);
      const epoch = BigInt(state.groupContext.epoch);
      const cursor = Number(doc.cursor) || 0;
      const existing = byEpoch.get(epoch);
      if (!existing || cursor < existing.cursor) byEpoch.set(epoch, { cursor, state });
      address = typeof doc.prev === 'string' ? doc.prev : undefined;
    }
    const chain = [...byEpoch.values()].sort((a, b) => a.cursor - b.cursor);
    const seedCursor = group.fetchCursor;
    const ranges = buildChainRanges(chain, seedCursor);
    if (ranges.length === 0) return;

    // Fetch the backlog (frontier, seedCursor] from the coordinator.
    const rpc = this.#rpc(group.coordinatorPubkey);
    /** @type {Array<{cursor: number, gid: string, msg_64: string, at: number}>} */
    const gap = [];
    let after = ranges[0].lo;
    for (let page = 0; page < 50; page++) {
      const { messages } = await rpc.fetchManyGroupMessages({
        groups: [{ gid, ...(after > 0 ? { after } : {}) }]
      });
      if (messages.length === 0) break;
      gap.push(...messages.filter((m) => m.cursor <= seedCursor));
      const maxCursor = Math.max(...messages.map((m) => m.cursor));
      if (maxCursor <= after || maxCursor >= seedCursor) break;
      after = maxCursor;
    }
    gap.sort((a, b) => a.cursor - b.cursor);

    /** @type {CordnChatMessage[]} */
    const recovered = [];
    for (const range of ranges) {
      let state = chain[range.index].state;
      for (const message of gap.filter((m) => m.cursor > range.lo && m.cursor <= range.hi)) {
        try {
          const key = await deriveGroupPayloadKey(state);
          const opaque = unsealPayload({ key, sealedBase64: message.msg_64 });
          let base64 = '';
          for (const byte of opaque) base64 += String.fromCharCode(byte);
          const processed = await processOpaqueMessage({
            state,
            opaqueMessageBase64: btoa(base64),
            skipOwnCommitsFor: this.pubkey
          });
          state = processed.newState;
          if (processed.kind === 'application') {
            const envelope = JSON.parse(processed.envelopeJson);
            if (validateEnvelope(envelope, processed.senderPubkey).valid) {
              recovered.push({
                cursor: message.cursor,
                pubkey: envelope.pubkey,
                content: envelope.content,
                at: message.at
              });
            }
          }
        } catch {
          // Sibling commit or ratchet miss — skip this message, keep going.
        }
      }
    }
    if (recovered.length === 0) return;
    const current = this.#group(gid);
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient merge map
    const byCursor = new Map(current.messages.map((m) => [m.cursor, m]));
    for (const message of recovered) {
      if (!byCursor.has(message.cursor)) byCursor.set(message.cursor, message);
    }
    this.#updateGroup(gid, {
      messages: [...byCursor.values()].sort((a, b) => a.cursor - b.cursor)
    });
    await this.#persistGroups();
  }

  /**
   * @param {{gid: string, state: import('ts-mls').ClientState, doc: Record<string, any>}} entry
   * @param {'seed' | 'fastForward'} action
   */
  #adoptSyncedGroup({ gid, state, doc }, action) {
    this.states.set(gid, state);
    const metadata = findGroupMetadata(state);
    const existing = action === 'fastForward' ? this.groups.find((g) => g.gid === gid) : undefined;
    const view = {
      gid,
      name: metadata?.name || existing?.name || `Gruppe ${gid.slice(0, 8)}`,
      coordinatorPubkey:
        doc.coordinator ?? existing?.coordinatorPubkey ?? this.coordinatorPubkeys[0],
      members: listMemberPubkeys(state),
      adminPubkeys: metadata?.adminPubkeys ?? [],
      fetchCursor: Math.max(existing?.fetchCursor ?? 0, Number(doc.cursor) || 0),
      messages: existing?.messages ?? [],
      viaSync: true
    };
    this.groups = [...this.groups.filter((g) => g.gid !== gid), view];
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
    const metadata = findGroupMetadata(state);
    this.groups = [
      ...this.groups,
      {
        gid,
        name: metadata?.name || `Gruppe ${gid.slice(0, 8)}`,
        coordinatorPubkey: welcome.coordinatorPubkey,
        members: listMemberPubkeys(state),
        adminPubkeys: metadata?.adminPubkeys ?? [],
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
    if (this.stopped) return;
    this.pollCount += 1;
    if (this.multiDevice && this.pollCount % TIP_POLL_EVERY === 0) {
      void this.syncFromTip().catch((error) => {
        this.error = `Geräte-Sync: ${error instanceof Error ? error.message : error}`;
      });
    }
    if (this.groups.length === 0) return;
    /** @type {Array<{cursor: number, gid: string, msg_64: string, at: number}>} */
    const messages = [];
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- transient dedupe, not UI state
    const activeCoordinators = [...new Set(this.groups.map((group) => group.coordinatorPubkey))];
    for (const coordinatorPubkey of activeCoordinators) {
      const coordinatorGroups = this.groups.filter(
        (group) => group.coordinatorPubkey === coordinatorPubkey
      );
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
        opaqueMessageBase64: btoa(base64),
        // Shared-leaf groups: never process our own sibling's Commits (§10).
        skipOwnCommitsFor: group.viaSync ? this.pubkey : undefined
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
      const metadata = findGroupMetadata(processed.newState);
      this.#updateGroup(message.gid, {
        fetchCursor: message.cursor,
        members: listMemberPubkeys(processed.newState),
        adminPubkeys: metadata?.adminPubkeys ?? [],
        ...(metadata?.name ? { name: metadata.name } : {})
      });
    } catch (error) {
      if (error instanceof SiblingCommitSkippedError) {
        // Benign: cursor advances, the new epoch arrives via the next tip sync.
        this.#updateGroup(message.gid, { fetchCursor: message.cursor });
        return true;
      }
      if (group.viaSync) {
        // §10.6: ahead-of-epoch messages on synced groups — do NOT advance the
        // cursor; the sibling's republished doc will fast-forward us.
        this.error = `Warte auf Geräte-Sync für ${group.name} (Nachricht ${message.cursor})`;
        return false;
      }
      // Undecryptable backlog (e.g. pre-join epochs) — skip forward, keep note.
      this.error = `Nachricht ${message.cursor} übersprungen: ${error instanceof Error ? error.message : error}`;
      this.#updateGroup(message.gid, { fetchCursor: message.cursor });
    }
    return true;
  }
}
