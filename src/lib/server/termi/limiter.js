/**
 * One per-IP budget for both Termi endpoints (/api/termi router + /api/termi/search):
 * a sentence usually hits both, so 30/min is per caller across them.
 */
import { createRateLimiter } from '../rate-limit.js';

export const termiLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });

/** One budget for every anonymous /api/termi/search caller together (key 'global'): a
 * botnet of rotating IPs must not turn tier 1 into unlimited nope-mcp traffic. */
export const termiSearchGlobalLimiter = createRateLimiter({ limit: 300, windowMs: 60_000 });
