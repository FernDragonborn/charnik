/*
 * Which layout the play screen takes (`work/play-layout.md` ▸ LAYOUT-WIDTHS): a finger gets the phone
 * layout, a mouse in a window below the columns threshold gets the panels dealt into columns of tabs,
 * and anything wider keeps the panel columns it has. Read live, so dragging the window re-lays it.
 */
import { MediaQuery } from 'svelte/reactivity';
import {
	COLUMNS_WINDOW_QUERY,
	FINGER_QUERY,
	NARROW_WINDOW_QUERY,
	THREE_COLUMNS_QUERY,
} from '#lib/config/narrow-window.ts';

export const PLAY_LAYOUT = { wide: 'wide', columns: 'columns', phone: 'phone' } as const;
export type PlayLayout = (typeof PLAY_LAYOUT)[keyof typeof PLAY_LAYOUT];

/** The panels each column holds, as the mock deals them (`narrow-desktop-variants.html`). */
export const COLUMN_GROUPS = {
	two: [
		['actions', 'spells', 'inventory'],
		['skills', 'effects', 'features'],
	],
	three: [
		['actions', 'inventory'],
		['spells', 'effects'],
		['skills', 'features'],
	],
} as const;

class PlayLayoutWatch {
	private finger = new MediaQuery(FINGER_QUERY);
	private narrow = new MediaQuery(NARROW_WINDOW_QUERY);
	private columns = new MediaQuery(COLUMNS_WINDOW_QUERY);
	private three = new MediaQuery(THREE_COLUMNS_QUERY);

	get current(): PlayLayout {
		if (this.finger.current && this.narrow.current) return PLAY_LAYOUT.phone;
		if (this.columns.current) return PLAY_LAYOUT.columns;
		return PLAY_LAYOUT.wide;
	}

	get groups(): readonly (readonly string[])[] {
		return this.three.current ? COLUMN_GROUPS.three : COLUMN_GROUPS.two;
	}
}

export const playLayout = new PlayLayoutWatch();
