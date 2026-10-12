/*
 * The closed WORD vocabularies some token kinds speak in — what an `extra_attack` says of its
 * attack, how often a `grant_roll` may be made, the sentences of a `form`. Data beside the parser
 * that reads them (`token-parser.ts`), which re-exports the public half so consumers keep one
 * import path.
 */
/** The closed vocabulary an `extra_attack` token speaks in. */
export const EXTRA_ATTACK_WORD = {
	/** made with the SAME weapon again (Cleave) */
	same: 'same',
	/** made with this weapon while ANOTHER carrying the property is wielded (Light) */
	other: 'other',
	bonus: 'bonus',
	free: 'free',
	modifier: 'modifier',
} as const;
export type ExtraAttackWord = (typeof EXTRA_ATTACK_WORD)[keyof typeof EXTRA_ATTACK_WORD];
export const EXTRA_ATTACK_WORDS: ReadonlySet<string> = new Set(Object.values(EXTRA_ATTACK_WORD));
/** Does this statement GRANT the attack, rather than re-price or adjust one another row grants? */
export const grantsExtraAttack = (words: readonly ExtraAttackWord[]): boolean =>
	words.includes(EXTRA_ATTACK_WORD.same) || words.includes(EXTRA_ATTACK_WORD.other);

/** How often a granted roll may be made, where its rule says so. An open enum: "once per turn" is
 *  the one the SRD's granted rolls state (Sneak Attack), and a rest-limited one would join it here. */
export const ROLL_LIMIT = { turn: 'turn' } as const;
export type RollLimit = (typeof ROLL_LIMIT)[keyof typeof ROLL_LIMIT];
export const isRollLimit = (word: string): word is RollLimit =>
	(Object.values(ROLL_LIMIT) as string[]).includes(word);

/**
 * The closed vocabulary a `form` token speaks in. Four words carry an L2 expression, three a bare
 * word, three nothing at all:
 *  - `creature:<type>` — the creature type an eligible stat block has (`beast`)
 *  - `max_cr:<expr>` — the highest Challenge Rating eligible; a fraction is written as one (`1/4`)
 *  - `without:<mode>` — a movement mode an eligible stat block may NOT have (`fly`, `swim`)
 *  - `own_hp` — the form has hit points of its own, the stat block's, and the character's wait
 *  - `temp_hp:<expr>` — Temporary Hit Points gained on assuming it
 *  - `known:<expr>` — how many forms the character knows, where they are chosen ahead of time
 *  - `hours:<expr>` — how long the form lasts
 *  - `casts` — spells can be cast in the form
 *  - `only_senses` — the character has no special sense in the form but the stat block's
 *  - `ends_when:<state>` — a state row's id that ends the form the moment the character has it
 */
export const FORM_WORD = {
	creature: 'creature',
	maxCr: 'max_cr',
	without: 'without',
	ownHp: 'own_hp',
	tempHp: 'temp_hp',
	known: 'known',
	hours: 'hours',
	casts: 'casts',
	onlySenses: 'only_senses',
	endsWhen: 'ends_when',
} as const;
export type FormWord = (typeof FORM_WORD)[keyof typeof FORM_WORD];
/** What each word is followed by. */
export const FORM_WORD_VALUE: Record<FormWord, 'expression' | 'word' | 'none'> = {
	creature: 'word',
	max_cr: 'expression',
	without: 'word',
	own_hp: 'none',
	temp_hp: 'expression',
	known: 'expression',
	hours: 'expression',
	casts: 'none',
	only_senses: 'none',
	ends_when: 'word',
};
export const isFormWord = (word: string): word is FormWord => word in FORM_WORD_VALUE;
/** Does this form word carry an L2 expression? What the linter asks before reading the value. */
export const formWordTakesExpression = (word: FormWord): boolean =>
	FORM_WORD_VALUE[word] === 'expression';
