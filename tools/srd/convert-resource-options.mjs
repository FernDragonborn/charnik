/*
 * Curated resource spend-options (piece 3) → content/srd-{2024,2014}/resource_options_srd.csv.
 * These are app-specific option rows that encode SRD mechanics (Flurry of Blows costs 1 Focus/Ki
 * point, etc.) — authored, not parsed from a prose table (there's no table to parse), analogous to
 * the CONDITIONS-1 effect tokens. `resource_id` links to a `grant_resource` id (a FLAT namespace —
 * `focus` in 2024, `ki` in 2014). `cost` is an L2 value expr (here integer literals); `action` is a
 * bounded token (v1: `note:` display); `action_type` places it in the turn economy.
 * Run: node tools/srd/convert-resource-options.mjs
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeCsv } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');

const COLUMNS = [
	'id',
	'systems',
	'source',
	'name_en',
	'name_uk',
	'text_en',
	'text_uk',
	'effects',
	'resource_id',
	'cost',
	'action',
	'action_type'
];

/** The three Monk options both editions share (each 1 point, a Bonus Action). Text is the SRD
 *  mechanical summary; the engine treats `action` as a display note in v1. */
const MONK_OPTIONS = [
	{
		id: 'flurry_of_blows',
		name_en: 'Flurry of Blows',
		text_en: 'Immediately after the Attack action, make two Unarmed Strikes as a Bonus Action.',
		action: 'note:Make two Unarmed Strikes'
	},
	{
		id: 'patient_defense',
		name_en: 'Patient Defense',
		text_en: 'Take the Dodge action as a Bonus Action.',
		action: 'note:Take the Dodge action'
	},
	{
		id: 'step_of_the_wind',
		name_en: 'Step of the Wind',
		text_en: 'Take the Disengage or Dash action as a Bonus Action; your jump distance is doubled.',
		action: 'note:Disengage or Dash; jump distance doubled'
	}
];

const row = (source, systems, resourceId, o) => ({
	id: o.id,
	systems,
	source,
	name_en: o.name_en,
	name_uk: '',
	text_en: o.text_en,
	text_uk: '',
	effects: '',
	resource_id: resourceId,
	cost: '1',
	action: o.action,
	action_type: 'bonus_action'
});

writeCsv(
	resolve(root, 'content/srd-2024/resource_options_srd.csv'),
	COLUMNS,
	MONK_OPTIONS.map((o) => row('SRD 5.2.1', '5.5e', 'focus', o))
);
writeCsv(
	resolve(root, 'content/srd-2014/resource_options_srd.csv'),
	COLUMNS,
	MONK_OPTIONS.map((o) => row('SRD 5.1', '5e', 'ki', o))
);
console.log('resource_options: 3 monk options × 2 editions');
