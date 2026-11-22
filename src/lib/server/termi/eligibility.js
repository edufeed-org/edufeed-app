/**
 * The Termi assistant's NIP-05 gate: only pubkeys listed in the `nostr.json`
 * of a domain in TERMI_ELIGIBLE_NIP05_DOMAINS may use /api/termi/chat.
 * Reuses the Blossom eligibility checker (fetch, cache, "undetermined") with
 * its own domain list. No domain = nobody is eligible and the assistant is off
 * (`isTermiLlmConfigured`), never a gate-less fallback.
 */
import { env } from '$env/dynamic/private';
import { createEligibilityChecker, normalizeDomain } from '../blossom-eligibility.js';
import { parseArray } from '../env-parse.js';

/**
 * @param {Record<string, string | undefined>} envVars
 * @returns {string[]}
 */
export function parseTermiDomains(envVars) {
  return parseArray(envVars.TERMI_ELIGIBLE_NIP05_DOMAINS).map(normalizeDomain).filter(Boolean);
}

/** @type {import('../blossom-eligibility.js').EligibilityChecker | undefined} */
let _checker;

/** Lazy singleton over the deployment's env. */
export function getTermiEligibilityChecker() {
  if (!_checker) {
    _checker = createEligibilityChecker({
      pubkeys: new Set(),
      domains: parseTermiDomains(env),
      gated: true
    });
  }
  return _checker;
}

/** Test seam. */
export function _resetTermiEligibilityForTests() {
  _checker = undefined;
}
