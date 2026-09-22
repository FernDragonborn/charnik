/*
 * SRD 5.2.1 (CC-BY-4.0) → srd/items_srd.csv
 * Weapons + armor from the HTML tables in equipment.md, adventuring gear from its
 * `#### Name (cost)` blocks, and magic items from magic-items.md. All tagged 5.5e.
 * Counts are asserted against the source. Run: node tools/srd/convert-items.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	abilities,
	blocks,
	description,
	slug,
	writeCsv,
	assertCount,
	dedupeIds,
	existingColById,
} from './lib.mjs';
import { packDir } from '../content-repo.mjs';
import { weaponTags, armorTags, magicItemHead, splitTopLevel } from './item-tags.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const src = (f) => readFileSync(resolve(root, 'tools/srd-src/2024', f), 'utf8');

const strip = (s) =>
	s
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&#39;|&rsquo;/g, "'")
		.trim();
const sectionBetween = (md, startRe, endRe) => {
	const s = md.search(startRe);
	const rest = md.slice(s);
	const e = rest.slice(1).search(endRe);
	return e === -1 ? rest : rest.slice(0, e + 1);
};
const firstTable = (s) => (/<table[\s\S]*?<\/table>/i.exec(s) || [''])[0];
const trCells = (tr, tag) =>
	[...tr.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => strip(m[1]));
const num = (s) => {
	const m = /(\d+(?:\.\d+)?)/.exec(s);
	return m ? Number(m[1]) : '';
};
const cost = (s) =>
	(/(\d[\d,]*\s*(?:GP|SP|CP|PP))/i.exec(s) || [''])[0].replace(/\s+/g, ' ').trim();

const COLUMNS = [
	'id',
	'systems',
	'source',
	'category',
	'tags',
	'damage',
	'base_item_id',
	'effects',
	'rarity',
	'cost',
	'weight_lb',
	'name_en',
	'name_uk',
	'text_en',
	'text_uk',
];
const blank = {
	name_uk: '',
	text_uk: '',
	effects: '',
	cost: '',
	weight_lb: '',
	tags: '',
	damage: '',
	base_item_id: '',
	rarity: '',
};
const row = (o) => ({ systems: '5.5e', source: 'SRD 5.2.1', ...blank, ...o });

const rows = [];
let nWeapon = 0,
	nArmor = 0,
	nGear = 0,
	nAmmo = 0,
	nTool = 0,
	nMagic = 0;

// --- weapons -----------------------------------------------------------------
{
	const sec = sectionBetween(src('equipment.md'), /^## Weapons/m, /^## Armor/m);
	const table = firstTable(sec);
	let type = '';
	for (const tr of table.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
		const grp = /<th[^>]*>\s*<em>(.+?)<\/em>/i.exec(tr);
		if (grp) {
			type = grp[1]
				.replace(/\s*Weapons$/i, '')
				.toLowerCase()
				.trim(); // "simple melee"
			continue;
		}
		const td = trCells(tr, 'td');
		if (td.length < 6) continue;
		const [name, dmg, props, mastery, weight, cst] = td;
		const dm = /(\d+d\d+)\s+(\w+)/.exec(dmg);
		rows.push(
			row({
				id: slug(name),
				name_en: name,
				text_en: '',
				category: 'weapon',
				tags: weaponTags({ group: type, properties: props === '—' ? '' : props, mastery }),
				cost: cost(cst),
				weight_lb: num(weight),
				damage: dm ? `${dm[1]} ${dm[2].toLowerCase()}` : '',
			}),
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
				id: slug(name),
				name_en: name,
				text_en: '',
				category: isShield ? 'shield' : 'armor',
				tags: armorTags({
					weight: isShield ? 'shield' : cat,
					ac: num(ac),
					dexCap,
					strMin: num(str),
					stealthDisadvantage: /disadvantage/i.test(stealth),
				}),
				cost: cost(cst),
				weight_lb: num(weight),
			}),
		);
		nArmor++;
	}
	assertCount('armor+shields', nArmor, 13);
}

// --- tools -------------------------------------------------------------------
// A tool is a `**Name (cost)**` bold line inside `## Tools`, not a `####` block, so the two `####`
// group headings (Artisan's Tools / Other Tools) carry every entry in their body. 5.5e states the
// ABILITY a tool's check uses — the one thing 2014 leaves to the GM — so it ships as a tag and the
// sheet never guesses one.
{
	const sec = sectionBetween(src('equipment.md'), /^## Tools/m, /^## Adventuring Gear/m);
	const lines = sec.split(/\r?\n/);
	let cur = null;
	const flush = () => {
		if (!cur) return;
		rows.push(
			row({
				id: slug(cur.name),
				name_en: cur.name,
				text_en: cur.body.filter(Boolean).join('\n'),
				category: 'tool',
				tags: cur.ability ? `ability:${cur.ability}` : '',
				cost: cost(cur.cost),
				weight_lb: num(cur.weight),
			}),
		);
		nTool++;
		cur = null;
	};
	for (const line of lines) {
		const head = /^\*\*(.+?)\s*\(([^)]*)\)\*\*\s*$/.exec(line);
		if (head) {
			flush();
			cur = { name: head[1].trim(), cost: head[2], ability: '', weight: '', body: [] };
			continue;
		}
		if (!cur) continue;
		const meta = /^\*\*Ability:\*\*\s*(\w+)\s*\*\*Weight:\*\*\s*(.+?)\s*$/.exec(line);
		if (meta) {
			cur.ability = abilities(meta[1]);
			cur.weight = meta[2];
			continue;
		}
		// "**Utilize:** …", "**Craft:** …", "**Variants:** …" — the entry's own prose, kept whole
		cur.body.push(strip(line.replace(/\*\*/g, '').replace(/_/g, '')).trim());
	}
	flush();
	assertCount('tools', nTool, 25); // 17 artisan's + 8 other
}

// --- adventuring gear --------------------------------------------------------
// The `####` entries carry the description and the price, but NOT the weight — that lives only in
// the Adventuring Gear table further down the same section, which is why every gear row shipped
// weightless and the encumbrance number was built out of armour and weapons alone.
const gearWeights = new Map();
for (const tr of firstTable(
	sectionBetween(src('equipment.md'), /^## Adventuring Gear/m, /^## Mounts and Vehicles/m),
).match(/<tr[\s\S]*?<\/tr>/gi) || []) {
	const td = trCells(tr, 'td');
	if (td.length < 2) continue;
	const [name, weight] = td;
	if (name) gearWeights.set(slug(name), num(weight)); // "Varies" / "—" → '' (no weight declared)
}

for (const b of blocks(src('equipment.md')).filter((b) => b.h2 === 'Adventuring Gear')) {
	const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(b.name);
	const name = m ? m[1].trim() : b.name;
	const id = slug(name);
	rows.push(
		row({
			id,
			name_en: name,
			text_en: description(b.body),
			category: 'gear',
			cost: m ? cost(m[2]) : '',
			weight_lb: gearWeights.get(id) ?? '',
		}),
	);
	nGear++;
}
assertCount('gear', nGear, 81);
// the table and the entries are two lists of the same 81 things; a mismatch means one of them moved
assertCount(
	'gear weights matched',
	[...gearWeights.keys()].filter((id) => rows.some((r) => r.id === id)).length,
	81,
);

// --- ammunition --------------------------------------------------------------
// The five types live ONLY in the Ammunition table inside the `ammunition` gear entry's prose — a
// <table>, which is not somewhere `src/` may read a value from — so the weapons that say
// `ammo:arrow` had nothing to spend. Each row carries the `ammo:<kind>` tag its weapons name, so the
// two halves match on a tag rather than on a name.
{
	const sec = sectionBetween(src('equipment.md'), /^\*\*Ammunition\*\*/m, /^#### /m);
	for (const tr of firstTable(sec).match(/<tr[\s\S]*?<\/tr>/gi) || []) {
		const td = trCells(tr, 'td');
		if (td.length < 5) continue;
		const [type, amount, storage, weight, cst] = td;
		// The kind a weapon's `ammo:` tag names is the FIRST word: "Bullets, Firearm" and "Bullets,
		// Sling" are both `bullet`, because the weapons table says "Bullet" for a sling and for a
		// musket alike. Two rows share the tag, and which one you load is the table's call — the
		// source draws no line a converter could.
		const kind = slug(type.split(',')[0] ?? type).replace(/s$/, '');
		rows.push(
			row({
				id: slug(type),
				name_en: type,
				text_en: `${amount} per purchase; stored in a ${storage}.`,
				category: 'ammunition',
				tags: `ammo:${kind}, quantity:${num(amount)}`,
				cost: cost(cst),
				weight_lb: num(weight),
			}),
		);
		nAmmo++;
	}
	assertCount('ammunition', nAmmo, 5);
}

// --- magic items -------------------------------------------------------------
// Magic-item `effects` tokens are authored AFTER conversion (MAGIC-ITEM-EFX) — curated from the SRD
// text into the bounded vocabulary, not present as such in the prose. Preserve them by id, or a raw
// re-run silently wipes the authoring (the failure class_features/conditions already hit).
const authoredEffects = existingColById(resolve(packDir('srd-2024'), 'items_srd.csv'), 'effects');

// A magic item is a `####` block whose first italic meta line carries a rarity
// (or "Rarity Varies"). Excludes the intro sections (no italic meta) and the embedded
// creature stat blocks (meta begins with a creature size, e.g. "_Large Beast,…_").
const RARITY = ['Very Rare', 'Uncommon', 'Common', 'Rare', 'Legendary', 'Artifact'];
const SIZE_RE = /^(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/;
// every mundane row converted above — what a magic item's `base_item_id` may point at
const mundaneIds = new Set(rows.map((r) => r.id));
for (const b of blocks(src('magic-items.md'))) {
	const metaLine = (b.body.find((l) => l.trim() !== '') || '').trim();
	const mm = /^_(.+)_$/.exec(metaLine);
	if (!mm) continue; // section explainer, no italic meta
	const inner = mm[1].trim();
	if (SIZE_RE.test(inner)) continue; // embedded creature stat block, not an item
	const hasRarity =
		RARITY.some((r) => new RegExp(r, 'i').test(inner)) || /rarity varies/i.test(inner);
	if (!hasRarity) continue;
	// depth-0 split: "Weapon (glaive, halberd, pike), Rare" is a TYPE with commas in it, and cutting
	// at the first one is what shipped `vorpal_sword` declaring itself a glaive
	const typeRaw = splitTopLevel(inner)[0] ?? '';
	const rarRaw = RARITY.find((r) => new RegExp(r, 'i').test(inner)) || ''; // blank when "Rarity Varies"
	const { category, baseItemId } = magicItemHead(typeRaw, mundaneIds);
	const id = slug(b.name);
	rows.push(
		row({
			id,
			name_en: b.name,
			text_en: description(b.body),
			effects: authoredEffects.get(id) ?? '', // preserve tokens authored post-conversion
			category,
			base_item_id: baseItemId,
			tags: /requires attunement/i.test(b.body.join('\n')) ? 'attunement' : '',
			rarity: rarRaw ? slug(rarRaw) : '',
		}),
	);
	nMagic++;
}
assertCount('magic items', nMagic, 258);

dedupeIds(rows);
writeCsv(resolve(packDir('srd-2024'), 'items_srd.csv'), COLUMNS, rows);
console.log(
	`wrote ${rows.length} items (weapons ${nWeapon}, armor ${nArmor}, tools ${nTool}, gear ${nGear}, ammo ${nAmmo}, magic ${nMagic})`,
);
