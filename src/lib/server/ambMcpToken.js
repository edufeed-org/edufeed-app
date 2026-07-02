/**
 * Cached client-credentials token provider for amb-mcp.
 *
 * amb-mcp gates `extract_metadata` behind an `mcp:extract` token. This module
 * obtains that token from Keycloak via the client-credentials grant and caches
 * it in memory until shortly before expiry, so `/api/enrich` sends a fresh JWT
 * without a token round-trip on every call.
 */

import { env } from '$env/dynamic/private';

/** Refresh this many ms before the token's stated expiry. */
const SKEW_MS = 60_000;

/**
 * @typedef {object} ClientCredentialsConfig
 * @property {string} tokenUrl
 * @property {string} clientId
 * @property {string} clientSecret
 * @property {string} [scope]
 */

/**
 * Build a cached token getter. Pure (no env access) so it is trivially testable.
 * @param {ClientCredentialsConfig} config
 * @returns {() => Promise<string>}
 */
export function createTokenProvider(config) {
  /** @type {{ token: string, expiresAt: number } | null} */
  let cached = null;
  /** @type {Promise<string> | null} */
  let inFlight = null;

  async function fetchToken() {
    if (!config.tokenUrl || !config.clientId || !config.clientSecret) {
      throw new Error(
        'amb-mcp client-credentials config incomplete (tokenUrl/clientId/clientSecret)'
      );
    }
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.clientId,
      client_secret: config.clientSecret
    });
    if (config.scope) body.set('scope', config.scope);

    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`amb-mcp token endpoint HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const token = json.access_token;
    if (typeof token !== 'string' || token === '') {
      throw new Error('amb-mcp token endpoint response missing access_token');
    }
    const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 60;
    cached = { token, expiresAt: Date.now() + expiresIn * 1000 - SKEW_MS };
    return token;
  }

  return async function getToken() {
    if (cached && Date.now() < cached.expiresAt) return cached.token;
    if (inFlight) return inFlight;
    inFlight = fetchToken().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

/** @type {(() => Promise<string>) | null} */
let singleton = null;

/**
 * Env-bound singleton getter used by the /api/enrich route.
 * @returns {Promise<string>} a valid amb-mcp bearer token.
 */
export function getAmbMcpToken() {
  if (!singleton) {
    singleton = createTokenProvider({
      tokenUrl: env.AMB_MCP_TOKEN_URL ?? '',
      clientId: env.AMB_MCP_CLIENT_ID ?? '',
      clientSecret: env.AMB_MCP_CLIENT_SECRET ?? '',
      scope: env.AMB_MCP_SCOPE || undefined
    });
  }
  return singleton();
}
