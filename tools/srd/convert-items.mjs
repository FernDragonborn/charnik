/*
 * SRD 5.2.1 (CC-BY-4.0) → content/srd/items_srd.csv
 * Weapons + armor from the HTML tables in equipment.md, adventuring gear from its
 * `#### Name (cost)` blocks, and magic items from magic-items.md. All tagged 5.5e.
 * Counts are asserted against the source. Run: node tools/srd/convert-items.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blocks, description, slug, writeCsv, assertCount, dedupeIds } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const src = (f) => readFileSync(resolve(root, 'tools/srd-src/2024', f), 'utf8');

const strip = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").trim();
const sectionBetween = (md, startRe, endRe) => {
	const s = md.search(startRe);
	const rest = md.slice(s);
	const e = rest.slice(1).search(endRe);
	return e === -1 ? rest : rest.slice(0, e + 1);
};
const firstTable = (s) => (/<table[\s\S]*?<\/table>/i.exec(s) || [''])[0];
const trCells = (tr, tag) => [...tr.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => strip(m[1]));
const num = (s) => {
	const m = /(\d+(?:\.\d+)?)/.exec(s);
	return m ? Number(m[1]) : '';
};
const cost = (s) => (/(\d[\d,]*\s*(?:GP|SP|CP|PP))/i.exec(s) || [''])[0].replace(/\s+/g, ' ').trim();

const COLUMNS = [
	'id', 'systems', 'source', 'name_en', 'name_uk', 'text_en', 'text_uk', 'effects',
	'category', 'item_type', 'cost', 'weight_lb', 'properties', 'damage', 'damage_type',
	'range', 'ac', 'armor_dex_cap', 'str_min', 'stealth_disadvantage', 'attunement', 'rarity'
];
const blank = {
	name_uk: '', text_uk: '', effects: '', cost: '', weight_lb: '', properties: '', damage: '',
	damage_type: '', range: '', ac: '', armor_dex_cap: '', str_min: '', stealth_disadvantage: 'false',
	attunement: 'false', rarity: ''
};
const row = (o) => ({ systems: '5.5e', source: 'SRD', ...blank, ...o });

const rows = [];
let nWeapon = 0, nArmor = 0, nGear = 0, nMagic = 0;

// --- weapons -----------------------------------------------------------------
{
	const sec = sectionBetween(src('equipment.md'), /^## Weapons/m, /^## Armor/m);
	const table = firstTable(sec);
	let type = '';
	for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
		const grp = /<th[^>]*>\s*<em>(.+?)<\/em>/i.exec(tr);
		if (grp) {
			type = grp[1].replace(/\s*Weapons$/i, '').toLowerCase().trim(); // "simple melee"
			continue;
		}
		const td = trCells(tr, 'td');
		if (td.length < 6) continue;
		const [name, dmg, props, mastery, weight, cst] = td;
		const dm = /(\d+d\d+)\s+(\w+)/.exec(dmg);
		const rng = /range\s+(\d+\/\d+)/i.exec(props);
		const propList = props === '—' ? '' : props;
		rows.push(
			row({
				id: slug(name), name_en: name, text_en: '',
				category: 'weapon', item_type: type, cost: cost(cst), weight_lb: num(weight),
				properties: (propList + (mastery && mastery !== '—' ? `; mastery: ${mastery}` : '')).replace(/^; /, ''),
				damage: dm ? dm[1] : '', damage_type: dm ? dm[2].toLowerCase() : '', range: rng ? rng[1] : ''
			})
		);
		nWeapon++;
	}
	assertCount('weapons', nWeapon, 38); // 37 with "lb." weights + Sling ("—" weight)
}

// --- armor + shields ---------------------------------------------------------
{
	const sec = sectionBetween(src('equipment.md'), /^## Armor/m, /^## Tools/m);
	const table = firstTable(sec);
	let cat = '';
	for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
		const grp = /<th[^>]*>\s*<em>(.+?)<\/em>/i.exec(tr);
		if (grp) {
			// group title e.g. "Heavy Armor (10 Minutes to Don…)" → keep just the class
			cat = (/(light|medium|heavy)/i.exec(grp[1]) || [, ''])[1].toLowerCase();
			continue;
		}
		const td = trCells(tr, 'td');
		if (td.length < 6) continue;
		const [name, ac, str, stealth, weight, cst] = td;
		const isShield = /^\+/.test(ac);
		const dexCap = isShield ? '' : cat === 'light' ? '' : cat === 'medium' ? '2' : '0';
		rows.push(
			row({
				id: slug(name), name_en: name, text_en: '',
				category: isShield ? 'shield' : 'armor',
				item_type: isShield ? 'shield' : `${cat} armor`,
				cost: cost(cst), weight_lb: num(weight),
				ac: num(ac), armor_dex_cap: dexCap, str_min: num(str),
				stealth_disadvantage: String(/disadvantage/i.test(stealth))
			})
		);
		nArmor++;
	}
	assertCount('armor+shields', nArmor, 13);
}

// --- adventuring gear --------------------------------------------------------
for (const b of blocks(src('equipment.md')).filter((b) => b.h2 === 'Adventuring Gear')) {
	const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(b.name);
	const name = m ? m[1].trim() : b.name;
	rows.push(
		row({
			id: slug(name), name_en: name, text_en: description(b.body),
			category: 'gear', item_type: 'adventuring gear', cost: m ? cost(m[2]) : ''
		})
	);
	nGear++;
}
assertCount('gear', nGear, 81);

// --- magic items -------------------------------------------------------------
// A magic item is a `####` block whose first italic meta line carries a rarity
// (or "Rarity Varies"). Excludes the intro sections (no italic meta) and the embedded
// creature stat blocks (meta begins with a creature size, e.g. "_Large Beast,…_").
const RARITY = ['Very Rare', 'Uncommon', 'Common', 'Rare', 'Legendary', 'Artifact'];
const SIZE_RE = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/;
for (const b of blocks(src('magic-items.md'))) {
	const metaLine = (b.body.find((l) => l.trim() !== '') || '').trim();
	const mm = /^_(.+)_$/.exec(metaLine);
	if (!mm) continue; // section explainer, no italic meta
	const inner = mm[1].trim();
	if (SIZE_RE.test(inner)) continue; // embedded creature stat block, not an item
	const hasRarity = RARITY.some((r) => new RegExp(r, 'i').test(inner)) || /rarity varies/i.test(inner);
	if (!hasRarity) continue;
	const typeRaw = inner.split(',')[0].trim();
	const rarRaw = RARITY.find((r) => new RegExp(r, 'i').test(inner)) || ''; // blank when "Rarity Varies"
	const head = typeRaw.toLowerCase();
	const category = head.startsWith('armor') ? 'armor' : head.startsWith('weapon') ? 'weapon' : head.startsWith('shield') ? 'shield' : head.startsWith('ammunition') ? 'ammunition' : 'gear';
	rows.push(
		row({
			id: slug(b.name), name_en: b.name, text_en: description(b.body),
			category, item_type: head, attunement: String(/requires attunement/i.test(b.body.join('\n'))),
			rarity: rarRaw ? slug(rarRaw) : ''
		})
	);
	nMagic++;
}
assertCount('magic items', nMagic, 258);

dedupeIds(rows);
writeCsv(resolve(root, 'content/srd/items_srd.csv'), COLUMNS, rows);
console.log(`wrote ${rows.length} items (weapons ${nWeapon}, armor ${nArmor}, gear ${nGear}, magic ${nMagic})`);
