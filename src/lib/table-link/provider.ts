/*
 * The one place a `TableLink` is chosen, as `storage/provider.ts` chooses a `Storage`: the desktop
 * app asks Rust, everything else has no table. Nothing above this names an implementation.
 */
import { Platform, detectPlatform } from '$lib/storage/platform';
import { noopTableLink } from './noop';
import { tauriTableLink } from './tauri';
import type { TableLink } from './types';

export const getTableLink = (): TableLink =>
	detectPlatform() === Platform.Desktop ? tauriTableLink : noopTableLink;
