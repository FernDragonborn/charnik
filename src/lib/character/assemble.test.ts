import { describe, it, expect } from 'vitest';
import { assembleCharacter } from './assemble';
import type { CharacterPlay, CharacterUi } from './schema';

const abilities = { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 8 };
const goodBuild = { name: 'Valen', abilities, classes: [{ class: 'class:SRD:wizard', level: 1 }] };

describe('assembleCharacter', () => {
	it('wraps a valid build into a Character, folding strict into ui and starting blank play', () => {
		const c = assembleCharacter(goodBuild, {
			id: 'valen',
			system: '5.5e',
			strict: true,
			play: null,
			ui: null
		});
		expect(c.id).toBe('valen');
		expect(c.system).toBe('5.5e');
		expect(c.build.name).toBe('Valen');
		expect(c.build.classes).toHaveLength(1);
		expect(c.ui.strict).toBe(true);
		expect(c.play.hp).toEqual({ current: 0, temp: 0 });
	});

	it('preserves an existing play-state and ui prefs when editing', () => {
		const play = { hp: { current: 5, temp: 2 } } as CharacterPlay;
		const ui = { panelColumns: [['skills']] } as Partial<CharacterUi>;
		const c = assembleCharacter(goodBuild, {
			id: 'valen',
			system: '5.5e',
			strict: false,
			play,
			ui
		});
		expect(c.play.hp.current).toBe(5);
		expect(c.ui.strict).toBe(false);
		expect(c.ui.panelColumns).toEqual([['skills']]);
	});

	it('falls back to a minimal valid character when the build is invalid', () => {
		const bad = { name: 'Broken', abilities, classes: [{ class: '', level: 1 }] }; // empty class ref
		const c = assembleCharacter(bad, {
			id: 'broken',
			system: '5e',
			strict: true,
			play: null,
			ui: null
		});
		expect(c.build.name).toBe('Broken');
		expect(c.build.classes).toEqual([]); // fallback keeps only name + abilities
		expect(c.id).toBe('broken');
	});
});
