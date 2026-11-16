/*
 * The table link of a build that has none: the web demo, a headless run, and — through
 * `tauri.ts`, which answers the same thing when its commands are not there — a desktop build
 * without the Cargo feature. No seat is ever given, so nothing else needs an implementation.
 */
import { SEATING, TABLE_ROLE, UNAVAILABLE, type TableLink } from './types';

const unavailable = () =>
	Promise.resolve({ status: SEATING.unavailable, reason: UNAVAILABLE.noTable });

export const noopTableLink: TableLink = {
	available: () => Promise.resolve(false),
	host: unavailable,
	join: unavailable,
	resume: () => Promise.resolve({ role: TABLE_ROLE.none }),
	remembered: () => Promise.resolve([]),
	returnTo: unavailable,
	forget: () => Promise.resolve(),
};
