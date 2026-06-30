/*
 * SRD 5.2.1 (CC-BY-4.0) monsters-A-Z.md + animals.md → content/srd/monsters_srd.csv
 * Headline stats (size/type/alignment/AC/HP/speed/abilities/CR/senses/languages/skills)
 * are parsed; full traits/actions stay verbatim in text_en. All tagged 5.5e. Count is
 * asserted against the source (one stat block == one "**AC**" line).
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
	s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/&[a-z]+;/g, ' ');
const field1 = (block, label) =>
	stripTags((new RegExp(`\\*\\*${label}\\*\\*\\s*([^\\n]+)`).exec(block) || [, ''])[1])
		.replace(/\s+/g, ' ')
		.trim();

function parseMonsters(md) {
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
			starts.push({ meta: i, name: headingFor[i], nameIdx: lines.lastIndexOf(headingFor[i] && `### ${headingFor[i]}`) });
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
		out.push({
			id: slug(s.name),
			systems: '5.5e',
			source: 'SRD',
			name_en: s.name,
			name_uk: '',
			text_en: flat.replace(/\n{2,}/g, '\n').trim(),
			text_uk: '',
			effects: '',
			size: m ? m[1].toLowerCase() : 'medium',
			creature_type: m ? m[2].toLowerCase() : '',
			alignment: m ? m[3].trim() : '',
			ac: (/\*\*AC\*\*\s*(\d+)/.exec(block) || [, ''])[1],
			hp: hp ? hp[1].replace(/,/g, '') : '',
			hp_formula: hp && hp[2] ? hp[2].trim() : '',
			speed: field1(block, 'Speed'),
			str: abil('STR'), dex: abil('DEX'), con: abil('CON'),
			int: abil('INT'), wis: abil('WIS'), cha: abil('CHA'),
			cr: (/\*\*CR\*\*\s*([0-9/]+)/.exec(block) || [, ''])[1],
			senses: field1(block, 'Senses'),
			languages: field1(block, 'Languages'),
			skills: field1(block, 'Skills')
		});
	}
	return out;
}

const rows = [...parseMonsters(srcFile('monsters-A-Z.md')), ...parseMonsters(srcFile('animals.md'))];
assertCount('monsters', rows.length, 330); // monsters-A-Z 235 + animals 95
dedupeIds(rows);

writeCsv(
	resolve(root, 'content/srd/monsters_srd.csv'),
	['id', 'systems', 'source', 'name_en', 'name_uk', 'text_en', 'text_uk', 'effects', 'size', 'creature_type', 'alignment', 'ac', 'hp', 'hp_formula', 'speed', 'str', 'dex', 'con', 'int', 'wis', 'cha', 'cr', 'senses', 'languages', 'skills'],
	rows
);
console.log(`wrote ${rows.length} monsters`);
console.log('CR spread:', [...new Set(rows.map((r) => r.cr))].filter(Boolean).sort().join(' '));
