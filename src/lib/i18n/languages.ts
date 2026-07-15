/*
 * Language reference — a broad code→names table for the translate view: the native name (shown), an
 * English name and (where useful) a Ukrainian name (both for SEARCH), so a user can find a language by
 * typing its name in English or Ukrainian or its code — even minority languages that `Intl.DisplayNames`
 * doesn't cover (Crimean Tatar, Rusyn, Sorbian, …). This is a display/lookup table only; the app's
 * ACTIVE locales are still DISCOVERED from content + UI catalogs (i18n-is-data-driven), never from here.
 * Codes are ISO 639-1 where one exists, else ISO 639-2/3 (e.g. `crh`). Extend freely.
 */

interface Language {
	/** shown in the picker — the language's own name in its own script. */
	native: string;
	/** English name (search). */
	en: string;
	/** Ukrainian name (search) — added for languages a UA user is likely to look up. */
	uk?: string;
}

const LANGUAGES: Record<string, Language> = {
	// — widely spoken / European —
	en: { native: 'English', en: 'English', uk: 'англійська' },
	uk: { native: 'Українська', en: 'Ukrainian', uk: 'українська' },
	de: { native: 'Deutsch', en: 'German', uk: 'німецька' },
	fr: { native: 'Français', en: 'French', uk: 'французька' },
	es: { native: 'Español', en: 'Spanish', uk: 'іспанська' },
	it: { native: 'Italiano', en: 'Italian', uk: 'італійська' },
	pt: { native: 'Português', en: 'Portuguese', uk: 'португальська' },
	pl: { native: 'Polski', en: 'Polish', uk: 'польська' },
	nl: { native: 'Nederlands', en: 'Dutch', uk: 'нідерландська' },
	cs: { native: 'Čeština', en: 'Czech', uk: 'чеська' },
	sk: { native: 'Slovenčina', en: 'Slovak', uk: 'словацька' },
	ru: { native: 'Русский', en: 'Russian', uk: 'російська' },
	be: { native: 'Беларуская', en: 'Belarusian', uk: 'білоруська' },
	sv: { native: 'Svenska', en: 'Swedish', uk: 'шведська' },
	no: { native: 'Norsk', en: 'Norwegian', uk: 'норвезька' },
	nb: { native: 'Norsk bokmål', en: 'Norwegian Bokmål' },
	nn: { native: 'Norsk nynorsk', en: 'Norwegian Nynorsk' },
	da: { native: 'Dansk', en: 'Danish', uk: 'данська' },
	fi: { native: 'Suomi', en: 'Finnish', uk: 'фінська' },
	is: { native: 'Íslenska', en: 'Icelandic', uk: 'ісландська' },
	fo: { native: 'Føroyskt', en: 'Faroese', uk: 'фарерська' },
	ro: { native: 'Română', en: 'Romanian', uk: 'румунська' },
	hu: { native: 'Magyar', en: 'Hungarian', uk: 'угорська' },
	el: { native: 'Ελληνικά', en: 'Greek', uk: 'грецька' },
	bg: { native: 'Български', en: 'Bulgarian', uk: 'болгарська' },
	mk: { native: 'Македонски', en: 'Macedonian', uk: 'македонська' },
	sr: { native: 'Српски', en: 'Serbian', uk: 'сербська' },
	hr: { native: 'Hrvatski', en: 'Croatian', uk: 'хорватська' },
	bs: { native: 'Bosanski', en: 'Bosnian', uk: 'боснійська' },
	sl: { native: 'Slovenščina', en: 'Slovenian', uk: 'словенська' },
	sq: { native: 'Shqip', en: 'Albanian', uk: 'албанська' },
	et: { native: 'Eesti', en: 'Estonian', uk: 'естонська' },
	lv: { native: 'Latviešu', en: 'Latvian', uk: 'латиська' },
	lt: { native: 'Lietuvių', en: 'Lithuanian', uk: 'литовська' },
	ga: { native: 'Gaeilge', en: 'Irish', uk: 'ірландська' },
	gd: { native: 'Gàidhlig', en: 'Scottish Gaelic', uk: 'шотландська' },
	cy: { native: 'Cymraeg', en: 'Welsh', uk: 'валлійська' },
	br: { native: 'Brezhoneg', en: 'Breton', uk: 'бретонська' },
	eu: { native: 'Euskara', en: 'Basque', uk: 'баскська' },
	ca: { native: 'Català', en: 'Catalan', uk: 'каталонська' },
	gl: { native: 'Galego', en: 'Galician', uk: 'галісійська' },
	oc: { native: 'Occitan', en: 'Occitan', uk: 'окситанська' },
	lb: { native: 'Lëtzebuergesch', en: 'Luxembourgish', uk: 'люксембурзька' },
	mt: { native: 'Malti', en: 'Maltese', uk: 'мальтійська' },
	// — minority / regional (Europe & post-Soviet) —
	crh: { native: 'Qırımtatarca', en: 'Crimean Tatar', uk: 'кримськотатарська' },
	rue: { native: 'Русиньскый', en: 'Rusyn', uk: 'русинська' },
	gag: { native: 'Gagauz', en: 'Gagauz', uk: 'гагаузька' },
	hsb: { native: 'Hornjoserbsce', en: 'Upper Sorbian', uk: 'верхньолужицька' },
	dsb: { native: 'Dolnoserbski', en: 'Lower Sorbian', uk: 'нижньолужицька' },
	csb: { native: 'Kaszëbsczi', en: 'Kashubian', uk: 'кашубська' },
	fy: { native: 'Frysk', en: 'Frisian', uk: 'фризька' },
	rm: { native: 'Rumantsch', en: 'Romansh', uk: 'ретороманська' },
	se: { native: 'Davvisámegiella', en: 'Northern Sami', uk: 'саамська' },
	tt: { native: 'Татарча', en: 'Tatar', uk: 'татарська' },
	ba: { native: 'Башҡортса', en: 'Bashkir', uk: 'башкирська' },
	cv: { native: 'Чӑвашла', en: 'Chuvash', uk: 'чуваська' },
	cu: { native: 'Словѣньскъ', en: 'Church Slavonic', uk: 'церковнословʼянська' },
	// — Caucasus / Central Asia —
	ka: { native: 'ქართული', en: 'Georgian', uk: 'грузинська' },
	hy: { native: 'Հայերեն', en: 'Armenian', uk: 'вірменська' },
	az: { native: 'Azərbaycanca', en: 'Azerbaijani', uk: 'азербайджанська' },
	kk: { native: 'Қазақша', en: 'Kazakh', uk: 'казахська' },
	ky: { native: 'Кыргызча', en: 'Kyrgyz', uk: 'киргизька' },
	uz: { native: 'Oʻzbekcha', en: 'Uzbek', uk: 'узбецька' },
	tk: { native: 'Türkmençe', en: 'Turkmen', uk: 'туркменська' },
	tg: { native: 'Тоҷикӣ', en: 'Tajik', uk: 'таджицька' },
	mn: { native: 'Монгол', en: 'Mongolian', uk: 'монгольська' },
	// — Middle East / South Asia —
	tr: { native: 'Türkçe', en: 'Turkish', uk: 'турецька' },
	ar: { native: 'العربية', en: 'Arabic', uk: 'арабська' },
	fa: { native: 'فارسی', en: 'Persian', uk: 'перська' },
	ku: { native: 'Kurdî', en: 'Kurdish', uk: 'курдська' },
	he: { native: 'עברית', en: 'Hebrew', uk: 'іврит' },
	ur: { native: 'اردو', en: 'Urdu', uk: 'урду' },
	hi: { native: 'हिन्दी', en: 'Hindi', uk: 'гінді' },
	bn: { native: 'বাংলা', en: 'Bengali', uk: 'бенгальська' },
	pa: { native: 'ਪੰਜਾਬੀ', en: 'Punjabi', uk: 'панджабі' },
	ta: { native: 'தமிழ்', en: 'Tamil', uk: 'тамільська' },
	te: { native: 'తెలుగు', en: 'Telugu', uk: 'телугу' },
	ml: { native: 'മലയാളം', en: 'Malayalam', uk: 'малаялам' },
	kn: { native: 'ಕನ್ನಡ', en: 'Kannada', uk: 'каннада' },
	si: { native: 'සිංහල', en: 'Sinhala', uk: 'сингальська' },
	ne: { native: 'नेपाली', en: 'Nepali', uk: 'непальська' },
	// — East / Southeast Asia —
	ja: { native: '日本語', en: 'Japanese', uk: 'японська' },
	zh: { native: '中文', en: 'Chinese', uk: 'китайська' },
	'zh-Hant': { native: '繁體中文', en: 'Chinese (Traditional)', uk: 'китайська (традиційна)' },
	ko: { native: '한국어', en: 'Korean', uk: 'корейська' },
	th: { native: 'ไทย', en: 'Thai', uk: 'тайська' },
	lo: { native: 'ລາວ', en: 'Lao', uk: 'лаоська' },
	km: { native: 'ខ្មែរ', en: 'Khmer', uk: 'кхмерська' },
	my: { native: 'မြန်မာ', en: 'Burmese', uk: 'бірманська' },
	vi: { native: 'Tiếng Việt', en: 'Vietnamese', uk: 'вʼєтнамська' },
	id: { native: 'Bahasa Indonesia', en: 'Indonesian', uk: 'індонезійська' },
	ms: { native: 'Bahasa Melayu', en: 'Malay', uk: 'малайська' },
	tl: { native: 'Tagalog', en: 'Tagalog', uk: 'тагальська' },
	// — Africa & others —
	sw: { native: 'Kiswahili', en: 'Swahili', uk: 'суахілі' },
	am: { native: 'አማርኛ', en: 'Amharic', uk: 'амхарська' },
	ha: { native: 'Hausa', en: 'Hausa', uk: 'хауса' },
	yo: { native: 'Yorùbá', en: 'Yoruba', uk: 'йоруба' },
	zu: { native: 'isiZulu', en: 'Zulu', uk: 'зулуська' },
	af: { native: 'Afrikaans', en: 'Afrikaans', uk: 'африкаанс' },
	// — constructed —
	eo: { native: 'Esperanto', en: 'Esperanto', uk: 'есперанто' },
	ia: { native: 'Interlingua', en: 'Interlingua', uk: 'інтерлінгва' },
	la: { native: 'Latina', en: 'Latin', uk: 'латина' }
};

/** Human-readable name for a locale code — its native name, else the code upper-cased (e.g. "EN-GB").
 *  Matches on the primary subtag first, so a regional code like `pt-BR` still resolves to "Português". */
export function languageName(code: string): string {
	const exact = LANGUAGES[code];
	if (exact) return exact.native;
	const primary = code.split('-')[0] ?? code;
	return LANGUAGES[primary]?.native ?? code.toUpperCase();
}

/** All searchable text for a code (native + English + Ukrainian names + the code), lower-cased — so the
 *  picker finds a language by any of those, even ones Intl.DisplayNames can't name. */
export function languageSearchText(code: string): string {
	const l = LANGUAGES[code] ?? LANGUAGES[code.split('-')[0] ?? code];
	return `${l?.native ?? ''} ${l?.en ?? ''} ${l?.uk ?? ''} ${code}`.toLowerCase();
}

/** Languages from {@link LANGUAGES} that aren't in `have` yet — the "add a language" menu, sorted by
 *  native name. `have` is the set of already-loaded content locales. */
export function addableLanguages(have: readonly string[]): { code: string; name: string }[] {
	const has = new Set(have);
	return Object.keys(LANGUAGES)
		.filter((code) => !has.has(code))
		.map((code) => ({ code, name: languageName(code) }))
		.sort((a, b) => a.name.localeCompare(b.name));
}
