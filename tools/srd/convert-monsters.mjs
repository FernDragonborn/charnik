/*
 * SRD 5.2.1 (CC-BY-4.0) monsters-A-Z.md + animals.md → content/srd/monsters_srd.csv
 * The whole stat-block header is parsed into columns (size/type/alignment/AC/initiative/HP/
 * speed/abilities/CR/resistances/immunities/vulnerabilities/gear/senses/languages/skills) —
 * including the HTML ability <table> — so nothing has to be scraped from text at runtime.
 * text_en holds ONLY the cleaned Traits/Actions prose after the "**CR**" line (Markdown kept,
 * the source's <br>/<table> HTML stripped, next-monster heading bleed cut). All tagged 5.5e.
 * Count asserted against the source (one stat block == one "**AC**" line).
 * Run: node tools/srd/convert-monsters.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug, writeCsv, assertCount, dedupeIds } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const srcFile = (f) => readFileSync(resolve(root, 'tools/srd-src/2024', f), 'utf8');

const META_RE = /^_(Tiny|Small|Medium|Large|Huge|Gargantuan)\b.*_\s*$/;
const stripTags = (s) =>
	s
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&#39;|&rsquo;/g, "'")
		.replace(/&[a-z]+;/g, ' ');
const field1 = (block, label) =>
	stripTags((new RegExp(`\\*\\*${label}\\*\\*\\s*([^\\n]+)`).exec(block) || [, ''])[1])
		.replace(/\s+/g, ' ')
		.trim();

// Prose (Traits/Actions) cleanup — keep Markdown (**, _, ####), drop HTML the source uses
// for the stat-block table + <br> line breaks. Used for text_en so it renders directly.
const cleanProse = (s) =>
	s
		.replace(/<br\s*\/?>/gi, '')
		.replace(/<\/?(?:table|thead|tbody|tr|th|td|strong|em|p|div|span)[^>]*>/gi, '')
		.replace(/&amp;/g, '&')
		.replace(/&#39;|&rsquo;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/&[a-z]+;/g, ' ')
		.replace(/[ \t]+/g, ' ')
		.replace(/ *\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

// `cutH3`: in monsters-A-Z, "### Name" is a monster name (cut it from prose); in animals,
// "### Actions" is a section heading to KEEP (only "## Name" cuts).
function parseMonsters(md, cutH3) {
	const lines = md.split(/\r?\n/);
	// nearest ## / ### heading name above each line
	const headingFor = [];
	let lastName = '';
	for (const l of lines) {
		const h = /^#{2,3}\s+(.+?)\s*$/.exec(l);
		if (h) lastName = h[1].trim();
		headingFor.push(lastName);
	}
	// a stat block = a size-meta line with "**AC**" within the next 4 lines
	const starts = [];
	for (let i = 0; i < lines.length; i++) {
		if (META_RE.test(lines[i]) && lines.slice(i + 1, i + 5).some((l) => /\*\*AC\*\*/.test(l))) {
			starts.push({
				meta: i,
				name: headingFor[i],
				nameIdx: lines.lastIndexOf(headingFor[i] && `### ${headingFor[i]}`)
			});
		}
	}
	const out = [];
	for (let k = 0; k < starts.length; k++) {
		const s = starts[k];
		// body runs from the meta line to just before the NEXT monster's name heading
		const end = k + 1 < starts.length ? starts[k + 1].meta : lines.length;
		const block = lines.slice(s.meta, end).join('\n');
		const flat = stripTags(block).replace(/[ \t]+/g, ' ');

		const m = /^_(\w+)\s+(.+),\s*([^,_]+)_/.exec(lines[s.meta]);
		const hp = /\*\*HP\*\*\s*([\d,]+)\s*(?:\(([^)]*)\))?/.exec(block);
		const abil = (a) => {
			const r = new RegExp(`\\b${a}\\b\\s+(\\d+)`).exec(flat);
			return r ? Number(r[1]) : '';
		};
		// saving throws live in the ability <table>'s 4th cell per ability (name/score/mod/SAVE)
		const save = (a) => {
			const r = new RegExp(
				`<strong>${a}</strong>\\s*</td>\\s*<td>\\s*\\d+\\s*</td>\\s*<td>[^<]*</td>\\s*<td>\\s*([+−\\-\\d]+)\\s*</td>`,
				'i'
			).exec(block);
			return r ? Number(r[1].replace('−', '-')) : '';
		};
		// text_en = only the prose after the stat-block header (which ends at the "**CR**"
		// line); the header's fields are all captured as columns below. Section headings vary
		// (#### Actions in monsters-A-Z, ### Actions in animals), so cut the tail at the NEXT
		// monster's own name heading (known) rather than by heading level.
		const crm = /\*\*CR\*\*[^\n]*/.exec(block);
		let prose = crm ? block.slice(crm.index + crm[0].length) : block;
		// cut the tail at the next monster/category name heading (keeps #### and, for animals,
		// ### section headings)
		const cut = prose.search(cutH3 ? /\n#{2,3} / : /\n## /);
		if (cut >= 0) prose = prose.slice(0, cut);
		out.push({
			id: slug(s.name),
			systems: '5.5e',
			source: 'SRD 5.2.1',
			name_en: s.name,
			name_uk: '',
			text_en: cleanProse(prose),
			text_uk: '',
			effects: '',
			size: m ? m[1].toLowerCase() : 'medium',
			creature_type: m ? m[2].toLowerCase() : '',
			alignment: m ? m[3].trim() : '',
			ac: (/\*\*AC\*\*\s*(\d+)/.exec(block) || [, ''])[1],
			initiative: field1(block, 'Initiative'),
			hp: hp ? hp[1].replace(/,/g, '') : '',
			hp_formula: hp && hp[2] ? hp[2].trim() : '',
			speed: field1(block, 'Speed'),
			str: abil('STR'),
			dex: abil('DEX'),
			con: abil('CON'),
			int: abil('INT'),
			wis: abil('WIS'),
			cha: abil('CHA'),
			str_save: save('STR'),
			dex_save: save('DEX'),
			con_save: save('CON'),
			int_save: save('INT'),
			wis_save: save('WIS'),
			cha_save: save('CHA'),
			cr: (/\*\*CR\*\*\s*([0-9/]+)/.exec(block) || [, ''])[1],
			resistances: field1(block, 'Resistances'),
			immunities: field1(block, 'Immunities'),
			vulnerabilities: field1(block, 'Vulnerabilities'),
			gear: field1(block, 'Gear'),
			senses: field1(block, 'Senses'),
			languages: field1(block, 'Languages'),
			skills: field1(block, 'Skills')
		});
	}
	return out;
}

const rows = [
	...parseMonsters(srcFile('monsters-A-Z.md'), true),
	...parseMonsters(srcFile('animals.md'), false)
];
assertCount('monsters', rows.length, 330); // monsters-A-Z 235 + animals 95
dedupeIds(rows);

writeCsv(
	resolve(root, 'content/srd-2024/monsters_srd.csv'),
	[
		'id',
		'systems',
		'source',
		'name_en',
		'name_uk',
		'text_en',
		'text_uk',
		'effects',
		'size',
		'creature_type',
		'alignment',
		'ac',
		'initiative',
		'hp',
		'hp_formula',
		'speed',
		'str',
		'dex',
		'con',
		'int',
		'wis',
		'cha',
		'str_save',
		'dex_save',
		'con_save',
		'int_save',
		'wis_save',
		'cha_save',
		'cr',
		'resistances',
		'immunities',
		'vulnerabilities',
		'gear',
		'senses',
		'languages',
		'skills'
	],
	rows
);
console.log(`wrote ${rows.length} monsters`);
console.log('CR spread:', [...new Set(rows.map((r) => r.cr))].filter(Boolean).sort().join(' '));
