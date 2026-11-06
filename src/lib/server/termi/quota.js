/**
 * Quota for /api/termi/chat, counted in LLM steps (= SAIA calls): per pubkey
 * per UTC day, plus a global cap per UTC month (SAIA's request budget).
 * `check` is free; the route charges each step via `charge`.
 *
 * shortcut: in-memory per process, resets on restart; revisit with replicas
 * or if the month counter must survive deploys.
 *
 * @param {{ perUserDaily: number, globalMonthly: number, now?: () => number }} opts
 */
export function createQuota({ perUserDaily, globalMonthly, now = Date.now }) {
  let day = '';
  let month = '';
  /** @type {Map<string, number>} */
  let perUser = new Map();
  let global = 0;

  function roll() {
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
    }
  };
}
