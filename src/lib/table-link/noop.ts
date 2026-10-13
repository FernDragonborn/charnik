/*
 * The table link of a build that has none: the web demo, a headless run, and — through
 * `tauri.ts`, which answers the same thing when its commands are not there — a desktop build
 * without the Cargo feature. No seat is ever given, so nothing else needs an implementation.
 */
import { SEATING, type TableLink } from './types';

const unavailable = () => Promise.resolve({ status: SEATING.unavailable });

export const noopTableLink: TableLink = { host: unavailable, join: unavailable };
