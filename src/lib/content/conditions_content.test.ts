import { describe, it, expect } from 'vitest';
import { MemoryStorage } from '../storage/memory';
import { loadContent } from './loader';
import { parseToken, splitGuard } from '../effects/token-parser';
import { readPackFile } from '../../test-support/real-content';

/*
 * Guards the SHIPPED condition data (CONDITIONS-1 authoring): the `effects` column we filled must
 * load cleanly, re-hash without drift, and contain only KNOWN effect tokens — a typo'd token would
 * silently become an inert note, so pin it here. Reads the real shipped files, not a fixture.
 */
const EDITIONS = [
	['5.5e', 'srd-2024'],
	['5e', 'srd-2014'],
] as const;

async function loadEdition(pack: string) {
	const s = new MemoryStorage();
	await s.write('c/conditions_srd.csv', readPackFile(pack, 'conditions_srd.csv'));
	return loadContent(s, ['c']);
}

describe('shipped conditions · effects column is engine-valid', () => {
	for (const [edition, path] of EDITIONS) {
		describe(edition, () => {
			it('loads with no errors and no hash drift (the re-stamp is correct)', async () => {
				const g = await loadEdition(path);
				expect(g.issues.filter((i) => i.level === 'error')).toEqual([]);
				expect(g.driftItems).toEqual([]);
			});

			it('every effect token is a KNOWN kind (no typo degrading to an inert note)', async () => {
				const g = await loadEdition(path);
				const rows = g.list('condition');
				expect(rows.length).toBeGreaterThan(10);
				for (const row of rows)
					for (const raw of row.data.effects ?? []) {
						const kind = parseToken(splitGuard(raw).token).kind;
						expect(kind, `${row.id}: "${raw}"`).not.toBe('unknown');
					}
			});

			/* The engine expands `apply_condition` exactly ONE level and says so three times
			   (`effects.md` — "no cascade"), which is a deliberate guard against a cycle. So a shipped
			   row that nests two deep is a CONTENT bug: `unconscious` listed `prone`, and `prone`'s own
			   `disadvantage:attack` reached nobody — the condition was named, queryable by every guard
			   and every `is_*` flag, and inert. Flatten the parent instead of widening the engine.
			   `note:` is exempt: it is display-only, the panel already tags the implied condition by
			   name, and hoisting every child note would duplicate the whole reference text. */
			it('nests no MECHANIC a parent does not also carry (the engine expands one level)', async () => {
				const g = await loadEdition(path);
				const effectsOf = (id: string) =>
					g.list('condition').find((r) => r.id === id)?.data.effects ?? [];
				const mechanics = (id: string) =>
					effectsOf(id).filter((t) => !splitGuard(t).token.startsWith('note:'));
				for (const row of g.list('condition'))
					for (const raw of effectsOf(row.id)) {
						const token = splitGuard(raw).token;
						if (!token.startsWith('apply_condition:')) continue;
						const child = token.slice('apply_condition:'.length);
						const parent = new Set(mechanics(row.id));
						const lost = mechanics(child).filter(
							(t) => !parent.has(t) && !t.startsWith('apply_condition:'),
						);
						expect(lost, `${row.id} → ${child}`).toEqual([]);
					}
			});

			it('wires the key mechanics (paralyzed / incapacitated / prone)', async () => {
				const g = await loadEdition(path);
				const effectsOf = (id: string) =>
					g.list('condition').find((r) => r.id === id)?.data.effects ?? [];
				// paralyzed: chains incapacitated, drops speed, auto-fails STR/DEX saves
				expect(effectsOf('paralyzed')).toEqual(
					expect.arrayContaining([
						'apply_condition:incapacitated',
						'set_override:speed:0',
						'auto_fail:save.str',
						'auto_fail:save.dex',
					]),
				);
				// prone carries at least one display-only note (attacks against you)
				expect(effectsOf('prone').some((t) => t.startsWith('note:'))).toBe(true);
				// EFX-E4: the grapple family zeros speed AND blocks any bonus to it (RAW "can't
				// benefit from a bonus to its speed") — the 0-set alone lets a later +10 survive.
				for (const id of ['grappled', 'restrained'])
					expect(effectsOf(id), id).toEqual(
						expect.arrayContaining(['set_override:speed:0', 'block_bonus:speed']),
					);
			});
		});
	}
});
