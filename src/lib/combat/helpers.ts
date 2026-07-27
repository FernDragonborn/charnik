/*
 * Barrel for the Combat-view pure helpers. This was one ~900-line junk-drawer of ~40 unrelated
 * exports; it's now split BY CONCERN into the sibling modules below, and this file just re-exports
 * them so the existing `$lib/combat/helpers` import path keeps working.
 *
 * ADD NEW HELPERS TO THE MATCHING CONCERN FILE, never here:
 *   roll.ts         — roll effects, pips, advantage, tray intent, dice list, roll-log type
 *   defense.ts      — resist/immune/vulnerable + effective max-HP
 *   effects-view.ts — the "Effects & conditions" panel view (why, tags, buffs/debuffs, durations)
 *   attacks.ts      — weapon attack rows, damage parsing, per-weapon magic bonus
 *   spells.ts       — spell rows/groups, cantrip scaling, per-class prepared accounting
 *   actions.ts      — the standard combat actions list
 *   constants.ts    — menu kinds, panel titles, ability names, mod targets, unit formatters
 */
export * from './roll';
export * from './defense';
export * from './effects-view';
export * from './attacks';
export * from './spells';
export * from './actions';
export * from './constants';
// re-exported so existing importers (`$lib/combat/helpers`) keep working after the F1/F2 dedup
export { titleCase, signed } from '$lib/util/format';
