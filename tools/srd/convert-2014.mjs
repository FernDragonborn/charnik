/*
 * SRD 5.1 (CC-BY-4.0, Tabyltop) → content/srd-2014/*.csv  (tagged 5e, source "SRD 5.1")
 * Prose types are parsed from the semantic HTML (SRD5.1-CCBY4.0License-TT.html): each
 * entry is an <h4 id='…'> with bold name, fields are <p><b>Label:</b>value</p>. Monsters
 * come from the pre-structured Monsters JSON. Counts asserted. Run: node tools/srd/convert-2014.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slug, writeCsv, assertCount, dedupeIds } from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const src = (f) => readFileSync(resolve(root, 'tools/srd-src/2014', f), 'utf8');
const out = (f) => resolve(root, 'content/srd-2014', f);
const SRC = 'SRD5.1-CCBY4.0License-TT';

const strip = (s) =>
	s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|’/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Walk the HTML into entries: {level, id, name, paras[]} (paras = raw inner-HTML of <p>). */
function htmlEntries(html) {
	const lines = html.split(/\r?\n/);
	const entries = [];
	let cur = null;
	for (const line of lines) {
		const h = /<h([234])[^>]*?(?:id='([^']*)')?[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>/i.exec(line);
		if (h) {
			if (cur) entries.push(cur);
			cur = { level: Number(h[1]), id: h[2] || '', name: strip(h[3]), paras: [] };
			continue;
		}
		const p = /<p>([\s\S]*?)<\/p>/i.exec(line);
		if (p && cur) cur.paras.push(p[1]);
	}
	if (cur) entries.push(cur);
	return entries;
}

/** Read a `<b>Label: </b>value` paragraph. */
const bField = (paras, label) => {
	for (const p of paras) {
		const m = new RegExp(`<b>\\s*${label}\\s*:\\s*</b>([\\s\\S]*)`, 'i').exec(p);
		if (m) return strip(m[1]);
	}
	return '';
};

const ABIL = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

// --- spells ------------------------------------------------------------------
function convertSpells() {
	const entries = htmlEntries(src(`${SRC}.html`));
	const SCHOOLS = ['abjuration', 'conjuration', 'divination', 'enchantment', 'evocation', 'illusion', 'necromancy', 'transmutation'];
	const rows = [];
	for (const e of entries) {
		const em = e.paras.map((p) => /<em>([\s\S]*?)<\/em>/i.exec(p)).find(Boolean);
		if (!em) continue;
		const meta = strip(em[1]); // "3rd-level Evocation" | "Evocation cantrip"
		let level, school;
		const lv = /^(\d)(?:st|nd|rd|th)-level\s+(\w+)/i.exec(meta);
		const ca = /^(\w+)\s+cantrip/i.exec(meta);
		if (lv) { level = Number(lv[1]); school = lv[2].toLowerCase(); }
		else if (ca) { level = 0; school = ca[1].toLowerCase(); }
		else continue;
		if (!SCHOOLS.includes(school)) continue;

		// Source quirks: some spells use singular "Component:", and a couple have the
		// "Casting Time" label split by PDF extraction into "Casting" + "Time:".
		const compRaw = bField(e.paras, 'Components?');
		const castingTime = bField(e.paras, 'Casting Time') || bField(e.paras, 'Time');
		const durRaw = bField(e.paras, 'Duration');
		// The Duration paragraph often glues the description straight onto the value
		// ("Instantaneous A bright…", "1 minuteA wall…"). Split at the first
		// lowercase→(optional space)→uppercase seam; if none, the value stands alone and
		// the description lives in later plain paragraphs.
		let duration = durRaw, gluedDesc = '';
		const seam = /([a-z,)])(\s*)([A-Z])/.exec(durRaw);
		if (seam) {
			const upAt = seam.index + seam[1].length + seam[2].length;
			duration = durRaw.slice(0, upAt).trim();
			gluedDesc = durRaw.slice(upAt).trim();
		}
		// description = the glued tail + any plain (non-<b>, non-<em>) paragraphs after
		// "At Higher Levels" rides in a <p><b><em>…</em></b> para (both tags) → pull it
		// out explicitly, and keep it out of the description.
		const ahlPara = e.paras.find((p) => /At Higher Levels/i.test(p));
		const higher = ahlPara ? strip(ahlPara).replace(/^.*?At Higher Levels\.?\s*/i, '').trim() : '';
		const plain = e.paras
			.filter((p) => !/<b>|<em>/i.test(p))
			.map(strip)
			.filter(Boolean);
		const descAll = [gluedDesc, ...plain].join('\n');
		const description = descAll.replace(/\n?At Higher Levels\.[\s\S]*$/i, '').trim();
		const low = description.toLowerCase();

		let resolution = 'none', save = '';
		if (/spell attack/.test(low)) resolution = 'attack';
		else {
			const sm = /(strength|dexterity|constitution|intelligence|wisdom|charisma) saving throw/.exec(low);
			if (sm) { resolution = 'save'; save = ABIL[sm[1]]; }
			else if (/regains? (?:a number of )?hit points|regains hit points/.test(low)) resolution = 'auto';
		}
		const dm = /(\d+d\d+)\s+([A-Za-z]+)\s+damage/.exec(description);
		const matM = /\(([^)]*)\)/.exec(compRaw);

		rows.push({
			id: slug(e.name), systems: '5e', source: 'SRD 5.1', name_en: e.name, name_uk: '',
			text_en: description, text_uk: '', effects: '',
			level, school,
			casting_time: castingTime,
			range: bField(e.paras, 'Range'),
			components: (compRaw.match(/\b[VSM]\b/g) || []).join(','),
			material: matM ? matM[1].trim() : '',
			duration, concentration: String(/^concentration/i.test(duration)), ritual: String(/ritual/i.test(castingTime)),
			classes: '', // SRD 5.1 lists classes separately, not in the spell block
			resolution, save_ability: save, damage: dm ? `${dm[1]} ${dm[2].toLowerCase()}` : '',
			higher_level: higher
		});
	}
	rows.sort((a, b) => a.level - b.level || a.id.localeCompare(b.id));
	assertCount('spells', rows.length, 319); // canonical SRD 5.1 spell count
	dedupeIds(rows);
	writeCsv(out('spells_srd.csv'),
		['id', 'systems', 'source', 'name_en', 'name_uk', 'text_en', 'text_uk', 'effects', 'level', 'school', 'casting_time', 'range', 'components', 'material', 'duration', 'concentration', 'ritual', 'classes', 'resolution', 'save_ability', 'damage', 'higher_level'],
		rows);
	console.log('spells by level:', Object.entries(rows.reduce((a, r) => ((a[r.level] = (a[r.level] || 0) + 1), a), {})).map(([l, n]) => `L${l}:${n}`).join(' '));
	return rows.length;
}

const n = convertSpells();
console.log(`wrote ${n} spells (SRD 5.1)`);
