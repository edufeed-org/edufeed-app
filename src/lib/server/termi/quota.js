import fs from 'node:fs';

/**
 * Quota for /api/termi/chat, counted in LLM steps (= SAIA calls): per pubkey
 * per UTC day, plus a global cap per UTC month (SAIA's request budget).
 * `check` is free; the route charges each step via `charge`.
 *
 * With `stateFile` the monthly `{ month, global }` is read once on first use
 * and written on every charge, so a deploy does not reset it. Per-pubkey
 * counts stay in memory on purpose (no pubkeys on disk).
 *
 * shortcut: without `stateFile` everything is in-memory and resets on restart;
 * one process only — revisit with replicas (a shared store).
 *
 * @param {{ perUserDaily: number, globalMonthly: number, now?: () => number, stateFile?: string }} opts
 */
export function createQuota({ perUserDaily, globalMonthly, now = Date.now, stateFile }) {
  let day = '';
  let month = '';
  /** @type {Map<string, number>} */
  let perUser = new Map();
  let global = 0;
  let loaded = !stateFile;

  function load() {
    loaded = true;
    try {
      const saved = JSON.parse(fs.readFileSync(/** @type {string} */ (stateFile), 'utf8'));
      if (typeof saved?.month === 'string' && Number.isInteger(saved.global)) {
        month = saved.month;
        global = saved.global;
      }
    } catch {
      // Missing or corrupt: start at 0.
    }
  }

  function save() {
    if (!stateFile) return;
    try {
      const tmp = `${stateFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ month, global }));
      fs.renameSync(tmp, stateFile);
    } catch (err) {
      console.error('[termi quota] state write failed:', err instanceof Error ? err.message : err);
    }
  }

  function roll() {
    if (!loaded) load();
    const iso = new Date(now()).toISOString();
    if (iso.slice(0, 10) !== day) {
      day = iso.slice(0, 10);
      perUser = new Map();
    }
    if (iso.slice(0, 7) !== month) {
      month = iso.slice(0, 7);
      global = 0;
    }
  }

  return {
    /** @param {string} pubkey @returns {'ok' | 'user' | 'global'} */
    check(pubkey) {
      roll();
      if (global >= globalMonthly) return 'global';
      if ((perUser.get(pubkey) ?? 0) >= perUserDaily) return 'user';
      return 'ok';
    },
    /** @param {string} pubkey */
    charge(pubkey) {
      roll();
      perUser.set(pubkey, (perUser.get(pubkey) ?? 0) + 1);
      global++;
      save();
    }
  };
}
