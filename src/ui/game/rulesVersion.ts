/**
 * Bump `RULES_VERSION` whenever a change alters how recorded actions replay (a new decision, a
 * changed roll order or legality, new rules for existing actions) and no replay shim in
 * `replay` covers it. A saved game of an older version is not replayed: the start screen offers
 * a new game instead. See docs/HANDOVER.md. Kept import-free so e2e specs can read it.
 */
export const RULES_VERSION = 7;

/** A record saved before versions existed (no `rules` field) is read as this one. */
export const LEGACY_RULES_VERSION = 1;
