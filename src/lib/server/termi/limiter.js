/**
 * Per-IP budget of /api/termi/search. The router (/api/termi) has its own, so
 * the cheap routing call never eats the search budget.
 */
import { createRateLimiter } from '../rate-limit.js';

export const termiLimiter = createRateLimiter({ max: 30, windowMs: 60_000 });

/** One budget for every anonymous /api/termi/search caller together (key 'global'): a
 * botnet of rotating IPs must not turn tier 1 into unlimited nope-mcp traffic. */
export const termiSearchGlobalLimiter = createRateLimiter({ max: 100, windowMs: 60_000 });
