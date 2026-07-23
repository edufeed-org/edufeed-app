// Single entry point for all Concord functionality. Everything outside
// src/lib/concord/ must import from here (enforced by no-restricted-imports)
// so pre-1.0 package churn stays contained in this directory.
// Exports grow as the wrapper modules land.
export { parseConcordPointer, buildConcordPointerTag, withConcordPointer } from './pointer.js';
