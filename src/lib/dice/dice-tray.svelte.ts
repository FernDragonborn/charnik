/*
 * The dice tray's live state: the lines, where the caret is, what is half-typed, which suggestion
 * is selected, and what pressing Roll does. The UI (`Roller.svelte`) binds to this and holds no state
 * of its own; the rules of the model live in `roller.ts`, which is pure.
 *
 * It knows nothing about the content graph or the active locale: the host hands it `candidates`
 * (built by `roller-vocabulary.ts`) and reads back the completed rolls. That is what lets the dev
 * preview drive the real tray with a fixture vocabulary, and it is why the same tray can be an
 * ad-hoc roll (an empty body) and a prefilled attack without a mode flag telling them apart.
 */
import { app } from '$lib/stores/app.svelte';
import { dealsDamage, type DamagePartSpec, type RollLogEntry } from '$lib/combat/roll';
import { damageSpecsOf, rollLines } from './roll-lines';
import {
	ADVANTAGE_MODE,
	NEXT_ADVANTAGE,
	type AdvantageMode,
	type BonusDie,
	type DieMods,
	type Rng,
} from '$lib/rules/dice';
import { signed } from '$lib/util/format';
import type { SaidValue } from '$lib/util/say';
import {
	PILL_KIND,
	ROLLER_ROLE,
	TOKEN_KIND,
	addToken,
	canRoll,
	countPill,
	dicePillToken,
	emptyLine,
	isInherited,
	normalizeLine,
	pillsFromPool,
	rollerIssues,
	type RollerLine,
	type RollerPill,
	type RollerRole,
} from './roller';
import {
	candidateResolver,
	isDamageType,
	matchCandidates,
	type RollerCandidate,
} from './roller-vocabulary';

/** What a caller hands the tray to build a roll it already knows about (an attack row, a spell).
 *  Both halves are optional and independent: a check is a test with no damage, a Fireball is damage
 *  with no test — the target saves, not you (§3). */
export interface RollerPrefill {
	label: string;
	/** The catalog key for `label`, carried straight through to the entries `roll()` answers with —
	 *  the dice tray has no locale and never turns it into a word. */
	labelKey?: string;
	/** ICU values for `labelKey` — a numbered strike's "1 of 2", a content row's own name. Carried for
	 *  the same reason the key is: without them the recorded row asks the catalog for a numbering frame
	 *  with no numbers in it. */
	labelValues?: Record<string, SaidValue>;
	test?: {
		dice: Record<number, number>;
		mod: number;
		advantage?: AdvantageMode;
		/** reroll / bounds that ride the pool's own dice (GWF, Reliable Talent). */
		mods?: DieMods;
		/** Signed effect dice (Bless +1d4). They arrive without the effect's NAME — see
		 *  `pillsFromPool` — but they arrive, which is more than the old tray managed. */
		bonusDice?: BonusDie[];
	};
	damage?: DamagePartSpec[];
	/** How many instances the ACTION fires — Eldritch Blast's beams. It belongs to the action and not
	 *  to its test half, because a damage-only spell can fire N times too (`roll()` reads the count
	 *  off whichever line carries it). It arrives as the same `×N` pill a person types, so the count
	 *  is visible and editable rather than a hidden multiplier. */
	times?: number;
	/** Provenance recorded with the roll — an upcast's "8d6 base + 1d6 @ slot 4". */
	note?: string;
}

/** The caret is in the LINE, not in the suggestion menu. `↓` moves it in, `↑` off the top row moves
 *  it back — so there is one selection, not a line selection and a menu selection at once. */
const IN_LINE = -1;

/** "The caret is at the end of the line", stored rather than recomputed: a line's length changes with
 *  every edit, and a caret parked at the end must STAY there without every mutation updating it.
 *  `caretAt` clamps it down to the real length on read. */
const AT_END = Number.MAX_SAFE_INTEGER;

export class DiceTray {
	/** What the roll is for ("Greataxe"). Empty for an ad-hoc roll. */
	label = $state('');
	labelKey = $state('');
	/** ICU values for `labelKey`, held beside it and travelling with it into every entry `roll()`
	 *  answers with. `undefined` rather than `{}`: "nobody gave me values" is not "there are none". */
	labelValues = $state<Record<string, SaidValue> | undefined>(undefined);
	/** Provenance carried into the logged entry (an upcast's extra dice), never shown as a pill —
	 *  it explains the roll rather than contributing to it. */
	note = $state('');
	lines = $state<RollerLine[]>([emptyLine(ROLLER_ROLE.test)]);
	/** The uncommitted text of each line, by line index — a token is text until a space parses it. */
	drafts = $state<string[]>(['']);
	/** Which line the caret is in. A die button from the header lands HERE, which is why the header
	 *  carries no role of its own. */
	focus = $state(0);
	/** `IN_LINE`, or the index of the selected suggestion row. */
	selected = $state(IN_LINE);
	/** What the lines can be told by name. The host owns this; the dice tray only reads it. */
	candidates = $state<RollerCandidate[]>([]);

	/** Where the caret sits IN each line, as the index of the pill it stands in front of. A line is a
	 *  row of tokens, so the caret walks it token by token: ← folds what is being typed back into a
	 *  pill and opens the one before it, → does the reverse, and typing inserts where the caret IS
	 *  rather than always at the end. */
	private carets = $state<number[]>([]);

	/** Esc closes the menu and leaves the text alone; typing anything opens it again. A flag rather
	 *  than an empty menu, because the matches are still there — it is the OFFER that was declined. */
	private dismissed = $state(false);

	/** Which type pill is being re-chosen, as `{line, pill}`, or null. A type pill has no caret to
	 *  click into, so the pill itself is the control: clicking one re-opens the SAME menu carrying the
	 *  only rows that could go there. "Slashing, actually" is then one click, not delete-and-retype. */
	retyping = $state<{ line: number; pill: number } | null>(null);

	/** What a line of THIS role may be told by name. A damage type is a fact about damage: on a d20
	 *  line it inserts a pill that means nothing, so it is not offered there and — because the same
	 *  list backs the resolver — typing the name in full can't get past what the menu withheld. */
	vocabularyFor = (role: RollerRole): RollerCandidate[] =>
		role === ROLLER_ROLE.damage
			? // and the mirror of it: advantage is a fact about d20s, so `adv` and the effects whose whole
				// contribution IS advantage are not offered on a damage line either
				this.candidates.filter((c) => c.insert.kind !== TOKEN_KIND.advantage)
			: this.candidates.filter((c) => !isDamageType(c));

	private roleAt = (index: number): RollerRole => this.lineAt(index)?.role ?? ROLLER_ROLE.test;

	draft = $derived(this.drafts[this.focus] ?? '');
	/** How a crit doubles. A table's house rule, not a per-roll choice — it is set once in Settings,
	 *  so the dice tray reads it and offers no switch of its own. */
	critMethod = $derived(app.critMethod);

	/** Every damage type there is, as menu rows — the list a clicked type pill offers. Nothing is
	 *  emboldened (`at: -1`) because nothing was typed to embolden. */
	private typeRows = $derived(
		this.candidates
			.filter(isDamageType)
			.map((candidate) => ({ candidate, at: -1, length: 0 }))
			.sort((a, b) => a.candidate.label.localeCompare(b.candidate.label)),
	);

	/** The menu, from whichever source opened it: what is being typed, or the types a clicked type
	 *  pill may become. ONE list, so ↓ ↑ Enter Esc need no second selection model.
	 *
	 *  Typing opens it the moment the token has a LETTER — digits and `d` belong to the dice parser
	 *  and must not raise a menu over a `2d6` in progress. */
	menu = $derived.by(() => {
		if (this.retyping) return this.typeRows;
		if (this.dismissed || !/\p{L}/u.test(this.draft)) return [];
		return matchCandidates(this.draft, this.vocabularyFor(this.roleAt(this.focus)));
	});

	/** Which row is highlighted. The top row is highlighted from the start — that is what the ghost
	 *  hint is previewing — so `selected` says whether the CARET moved into the menu, not whether
	 *  anything is chosen. A type picker highlights NOTHING until you arrow into it: there is no ghost
	 *  previewing a top row, and a highlight that Enter wouldn't take is a lie. */
	highlight = $derived.by(() => {
		if (!this.menu.length) return IN_LINE;
		const clamped = Math.min(this.selected, this.menu.length - 1);
		return this.retyping ? clamped : Math.max(0, clamped);
	});
	inMenu = $derived(this.selected !== IN_LINE && this.menu.length > 0);

	/** The grey completion drawn inline, editor style: the rest of the highlighted row's name, then
	 *  what it would insert. So what Tab does is legible before Tab. */
	ghost = $derived.by(() => {
		const top = this.menu[this.highlight];
		// nothing was typed to complete when the menu came from a pill, so there is no ghost
		if (!top || this.retyping) return '';
		const rest = top.at === 0 ? top.candidate.label.slice(this.draft.length) : '';
		// what Tab INSERTS, when that is not already what completing the word spells out: a row with no
		// chip (a damage type, a mode) says its whole self in the completion, and "ad|vantage → advantage"
		// is the same word twice. A row matched in another language has no completion, so there the name
		// is the only thing the ghost can show.
		const tail = top.candidate.preview || (rest ? '' : top.candidate.label);
		return tail ? `${rest} → ${tail}` : rest;
	});

	issues = $derived(rollerIssues(this.lines));
	/** Whether Roll does anything. The button reads this to go muted rather than inert-on-press. */
	rollable = $derived(canRoll(this.lines));

	/** The damage line, created on demand — a check has none, and "add damage" is not a mode. */
	private lineAt(index: number): RollerLine | undefined {
		return this.lines[index];
	}

	private replace(index: number, line: RollerLine): void {
		this.lines = this.lines.map((l, i) => (i === index ? line : l));
	}

	private setDraft(index: number, text: string): void {
		this.drafts = this.lines.map((_, i) => (i === index ? text : (this.drafts[i] ?? '')));
		this.selected = IN_LINE;
		this.dismissed = false;
		// typing is the other source of the menu — it takes it back from the pill
		this.retyping = null;
	}

	/** Where the caret is in a line: the index of the pill it stands in front of, `pills.length` at the
	 *  end. Clamped on read, so a caret parked at the end survives every edit. */
	caretAt = (index: number): number =>
		Math.max(0, Math.min(this.carets[index] ?? AT_END, this.lineAt(index)?.pills.length ?? 0));

	private setCaret(index: number, at: number): void {
		this.carets = this.lines.map((_, i) => (i === index ? at : (this.carets[i] ?? AT_END)));
	}

	/** Put the caret back at the end of a line — what clicking the empty rest of the row means. */
	caretToEnd = (index: number): void => this.setCaret(index, AT_END);

	/** Type into a line. Whitespace is what parses a token — feedback BEFORE the roll rather than
	 *  after it (§4) — so the field's whole content splits on it: everything before the last gap is
	 *  finished, and the tail is still being typed. Pasting a whole formula therefore lands as pills
	 *  by the same rule, without a second path. */
	type = (index: number, text: string): void => {
		const tokens = text.split(/\s+/);
		const tail = tokens.pop() ?? '';
		for (const token of tokens) this.commitText(index, token);
		this.setDraft(index, tail);
	};

	/** `↓` moves the caret out of the line and into the menu; `↑` off the top row brings it back. One
	 *  selection, never a line selection and a menu selection at once. */
	selectDown = (): void => {
		// from the HIGHLIGHTED row, not from `selected`: a typed menu highlights its top row from the
		// start (that is what the ghost is previewing), so stepping from `selected` spent the first ↓
		// re-selecting the row that already looked selected. A picker highlights nothing until you
		// arrive, and there `highlight` is IN_LINE — so the same expression still enters at row 0.
		if (this.menu.length) this.selected = Math.min(this.highlight + 1, this.menu.length - 1);
	};
	selectUp = (): void => {
		this.selected = this.selected <= 0 ? IN_LINE : this.selected - 1;
	};
	/** `←` / `→` in a menu laid out in COLUMNS: one column over is `stride` rows along a column-first
	 *  list. The stride is the view's to know — how many columns the picker draws is a layout fact, and
	 *  the tray only ever sees a flat list. Clamped rather than wrapping: the top row is where `↑`
	 *  leaves for the line, and a sideways key that could also leave would be two exits. */
	selectAcross = (stride: number): void => {
		if (!this.menu.length) return;
		const from = this.highlight;
		// with nothing highlighted yet (a picker you have not arrowed into) a sideways key ENTERS the
		// list, the same as ↓ — it should not land you halfway down the second column
		this.selected =
			from === IN_LINE ? 0 : Math.max(0, Math.min(from + stride, this.menu.length - 1));
	};
	dismissMenu = (): void => {
		this.dismissed = true;
		this.selected = IN_LINE;
		this.retyping = null;
	};

	/** Click a damage-type pill: the menu opens carrying every type, so changing one is a pick rather
	 *  than a delete-and-retype. Clicking the SAME pill again closes it — one control, two states —
	 *  and clicking anything else closes it too. */
	retype = (index: number, pillIndex: number): void => {
		const pill = this.lineAt(index)?.pills[pillIndex];
		const open = this.retyping?.line === index && this.retyping.pill === pillIndex;
		this.retyping =
			!open && pill?.kind === PILL_KIND.damageType ? { line: index, pill: pillIndex } : null;
		this.selected = IN_LINE;
	};

	/** Commit a finished token into a line, WHERE THE CARET IS. The line is split at the caret and the
	 *  token added to the head, so everything `addToken` decides from context — a bound landing on the
	 *  last die, a type closing the group — reads the tokens to the LEFT of the caret, which is what
	 *  "insert here" has to mean. With the caret at the end (the usual case) the head is the whole
	 *  line and this is exactly what it always did. */
	private commitText(index: number, text: string): void {
		const line = this.lineAt(index);
		if (!line || !text.trim()) return;
		const at = this.caretAt(index);
		const head: RollerLine = { ...line, pills: line.pills.slice(0, at) };
		const grown = addToken(head, text, candidateResolver(this.vocabularyFor(line.role)));
		this.replace(
			index,
			normalizeLine({ ...grown, pills: [...grown.pills, ...line.pills.slice(at)] }),
		);
		// by however many pills the token became, not by one: a compound token (`2d6+3`) adds several,
		// and a caret left inside it puts the next token in the MIDDLE of what was just typed — which
		// on a damage line hands a modifier to the wrong damage type
		const added = grown.pills.length - head.pills.length;
		if (added > 0) this.setCaret(index, at + added);
	}

	/** Put a finished pill in at the caret — the mouse's half of `commitText`. */
	private insertPill(index: number, pill: RollerPill): void {
		const line = this.lineAt(index);
		if (!line) return;
		const at = this.caretAt(index);
		this.replace(
			index,
			normalizeLine({
				...line,
				pills: [...line.pills.slice(0, at), pill, ...line.pills.slice(at)],
			}),
		);
		this.setCaret(index, at + 1);
	}

	/** Take a suggestion: the pill lands in the line and the caret comes out the far side of it, which
	 *  is what Tab, Enter and a click all do (§6 — they are one act, not three). */
	pick = (index: number, candidate: RollerCandidate): void => {
		const line = this.lineAt(index);
		if (!line) return;
		// a pick from a type pill REPLACES it rather than appending — and the replacement is a typed
		// pill, so re-choosing an inherited one is how you stop it inheriting
		const retyping = this.retyping;
		if (retyping && candidate.insert.kind === TOKEN_KIND.pill) {
			const chosen = candidate.insert.pill;
			this.retyping = null;
			this.replace(
				index,
				normalizeLine({
					...line,
					pills: line.pills.map((p, i) => (i === retyping.pill ? chosen : p)),
				}),
			);
			return;
		}
		if (candidate.insert.kind === TOKEN_KIND.advantage)
			this.replace(index, { ...line, advantage: candidate.insert.mode });
		else if (candidate.insert.kind === TOKEN_KIND.pill)
			this.insertPill(index, candidate.insert.pill);
		this.setDraft(index, '');
	};

	/** Take whatever the caret is on: the selected suggestion if the menu has one, else the top row,
	 *  else the raw text. The one path Tab/Enter and the Roll button share, so a half-typed token can
	 *  never be silently dropped by rolling. */
	commit = (index: number): void => {
		// the menu belongs to the FOCUSED line's draft; committing another line takes its text as typed
		const hit = index === this.focus ? this.menu[this.highlight] : undefined;
		const text = this.drafts[index] ?? '';
		if (!text.trim()) return;
		this.setDraft(index, '');
		if (hit) this.pick(index, hit.candidate);
		else this.commitText(index, text);
	};

	/**
	 * Step the caret one token LEFT: what is being typed folds back into the line where it stood, and
	 * the token now before the caret opens as text. ←, Backspace on an empty draft and Ctrl+Z are all
	 * this one move — a line is a row of tokens, and this is how you reach one that is not the last.
	 *
	 * An INHERITED type is stepped over: it is derived, not typed, so `normalizeLine` re-creates it the
	 * instant it is removed — which used to make Backspace unable to ever reach the die in front of it,
	 * no matter how many times it was pressed.
	 *
	 * Answers whether it actually MOVED. The caller re-places the text caret inside the token it
	 * arrived in, and doing that on a step that went nowhere is how ← at the head of a line threw you
	 * back to the end of the token you were already editing.
	 */
	caretLeft = (index: number): boolean => {
		// where the draft stands, read BEFORE folding it: the fold puts a pill there and moves the caret
		// past it, and stepping from the new position would just re-open the token we only just closed
		const from = this.caretAt(index);
		const line = this.lineAt(index);
		if (!line) return false;
		const at = line.pills.slice(0, from).findLastIndex((p) => !isInherited(p));
		// at the head of the line there is nothing to step into — so stay in the token being edited
		// rather than folding it away and leaving the caret parked past it
		if (at < 0) return false;
		this.commit(index);
		this.openPillAt(index, at);
		return true;
	};

	/** The mirror of `caretLeft`: fold what is being typed back in and open the token AFTER it, so a
	 *  caret that walked into the middle of a line can walk back out of it. With no token ahead the
	 *  caret goes to the end of the line and the draft is left alone — there is nothing to open. */
	caretRight = (index: number): boolean => {
		const line = this.lineAt(index);
		if (!line) return false;
		const from = this.caretAt(index);
		// counted before the fold: folding the draft inserts a pill AT the caret, pushing these right
		const ahead = line.pills.slice(from).findIndex((p) => !isInherited(p));
		if (ahead < 0) {
			this.caretToEnd(index);
			return false;
		}
		this.commit(index);
		this.openPillAt(index, this.caretAt(index) + ahead);
		return true;
	};

	/** Unfold the pill at `at` into the draft and leave the caret in its place. The pill keeps the
	 *  token it was made from precisely so this is lossless. */
	private openPillAt(index: number, at: number): void {
		const line = this.lineAt(index);
		const pill = line?.pills[at];
		if (!line || !pill) return;
		this.replace(index, normalizeLine({ ...line, pills: line.pills.filter((_, i) => i !== at) }));
		this.setDraft(index, pill.text);
		this.setCaret(index, at);
	}

	/** Unfold any pill — what a double-click does ("Bless → Bane" without retyping). An inherited type
	 *  has nothing to unfold TO: it was never typed, and removing it only makes `normalizeLine` put it
	 *  straight back. Re-choosing it (a click) is what makes it a real pill. */
	unfold = (index: number, pillIndex: number): void => {
		if (isInherited(this.lineAt(index)?.pills[pillIndex])) return;
		this.openPillAt(index, pillIndex);
	};

	/** Take a pill out. An inherited type is not one to take out — it is re-derived from the group on
	 *  its left, so deleting it does nothing except look broken; the type it inherited FROM is the one
	 *  to edit. */
	removePill = (index: number, pillIndex: number): void => {
		const line = this.lineAt(index);
		if (!line || isInherited(line.pills[pillIndex])) return;
		this.replace(
			index,
			normalizeLine({ ...line, pills: line.pills.filter((_, i) => i !== pillIndex) }),
		);
		// a pill taken out from the LEFT of the caret would otherwise shift the caret one token right.
		// Asked of the STORED caret, not of `caretAt`: that clamps `AT_END` down to the line's length,
		// so a caret nobody has ever moved reported "in front of the last pill", the guard fired, and
		// the sentinel that exists to keep the caret at the end was materialised one place short of it.
		const caret = this.carets[index] ?? AT_END;
		if (caret !== AT_END && pillIndex < caret) this.setCaret(index, caret - 1);
	};

	/** Nudge a pill's quantity — the −/+ that appear on hover. They exist because a pill has no caret
	 *  to click into, so without them a mouse could add a die and never change how many (§4).
	 *  A dice pill counts dice; a flat pill counts itself. */
	bumpPill = (index: number, pillIndex: number, delta: number): void => {
		const line = this.lineAt(index);
		const pill = line?.pills[pillIndex];
		if (!line) return;
		let next: RollerPill;
		if (pill?.kind === PILL_KIND.dice) {
			const count = pill.count + delta;
			if (count < 1) return this.removePill(index, pillIndex);
			// through the shared builder, so the token keeps the SIGN a penalty die is spelled with: a
			// nudged Bane die used to read `2d4`, and unfolding that made it a bonus
			next = { ...pill, count, text: dicePillToken({ ...pill, count }) };
		} else if (pill?.kind === PILL_KIND.flat) {
			const amount = pill.amount + delta;
			if (amount === 0) return this.removePill(index, pillIndex);
			next = { ...pill, amount, text: signed(amount) };
		} else return;
		this.replace(index, { ...line, pills: line.pills.map((p, i) => (i === pillIndex ? next : p)) });
	};

	/** Move a pill between lines — the whole of drag-and-drop's model (§4). */
	movePill = (from: number, pillIndex: number, to: number): void => {
		const source = this.lineAt(from);
		const target = this.lineAt(to);
		const pill = source?.pills[pillIndex];
		if (!source || !target || !pill || from === to) return;
		// the mouse may not reach a state the keyboard cannot: `vocabularyFor` withholds damage types
		// from a test line, so a dragged one would sit there as a real pill contributing nothing to
		// `testRoll` and reported by nothing
		if (pill.kind === PILL_KIND.damageType && target.role !== ROLLER_ROLE.damage) return;
		this.lines = this.lines.map((l, i) => {
			if (i === from)
				return normalizeLine({ ...l, pills: l.pills.filter((_, k) => k !== pillIndex) });
			if (i === to) return normalizeLine({ ...l, pills: [...l.pills, pill] });
			return l;
		});
		// both lines changed length; `removePill`'s reasoning applies to the line it LEFT, and the pill
		// lands at the end of the line it joined
		const caret = this.carets[from] ?? AT_END;
		if (caret !== AT_END && pillIndex < caret) this.setCaret(from, caret - 1);
		this.caretToEnd(to);
	};

	/** A die button in the header: it lands in the line the caret is in. The header has no role of its
	 *  own precisely so it never has to ask which half you meant. */
	addDie = (sides: number): void => this.commitText(this.focus, `1d${sides}`);
	/** The `±mod` button. It exists for VISIBILITY, not speed: typing "+2" is a thing you know how to
	 *  do and a new player does not (§8). */
	addMod = (): void => this.commitText(this.focus, '+1');

	cycleAdvantage = (index: number): void => {
		const line = this.lineAt(index);
		if (!line) return;
		this.replace(index, { ...line, advantage: NEXT_ADVANTAGE[line.advantage] });
	};

	toggleCrit = (index: number): void => {
		const line = this.lineAt(index);
		if (line) this.replace(index, { ...line, crit: !line.crit });
	};

	/** A damage line, added on demand. */
	addDamageLine = (): void => {
		this.lines = [...this.lines, emptyLine(ROLLER_ROLE.damage)];
		this.drafts = [...this.drafts, ''];
		this.focus = this.lines.length - 1;
	};

	reset = (): void => {
		this.label = '';
		this.labelKey = '';
		this.labelValues = undefined;
		this.note = '';
		this.lines = [emptyLine(ROLLER_ROLE.test)];
		this.drafts = [''];
		// empty = every caret at the end of its line, which is where a fresh one belongs
		this.carets = [];
		this.focus = 0;
		this.selected = IN_LINE;
		this.retyping = null;
	};

	/** Build the tray for a roll the app already knows about. The second line exists only when there
	 *  IS damage — which is the whole rule for when a roller has two lines (§3). */
	prefill = (spec: RollerPrefill): void => {
		this.reset();
		this.label = spec.label;
		this.labelKey = spec.labelKey ?? '';
		this.labelValues = spec.labelValues;
		this.note = spec.note ?? '';
		const lines: RollerLine[] = [];
		if (spec.test)
			lines.push({
				...emptyLine(ROLLER_ROLE.test),
				pills: pillsFromPool(spec.test.dice, spec.test.mod, {
					...(spec.test.mods ? { mods: spec.test.mods } : {}),
					...(spec.test.bonusDice?.length ? { bonusDice: spec.test.bonusDice } : {}),
				}),
				advantage: spec.test.advantage ?? ADVANTAGE_MODE.neither,
			});
		this.lines = lines;
		this.drafts = lines.map(() => '');
		this.carets = [];
		this.focus = 0;
		if (spec.damage?.length) this.setDamage(spec.damage);
		// neither half — an ad-hoc roll is still this dice tray, with an empty line to type into. The
		// fallback runs AFTER the damage, or a damage-only roll would be given a test line it has no
		// use for (an advantage toggle and a to-hit total on a Fireball).
		if (!this.lines.length) {
			this.lines = [emptyLine(ROLLER_ROLE.test)];
			this.drafts = [''];
		}
		// the count belongs to the ACTION, so it goes on the first line the action HAS. `roll()` reads
		// it off whichever line carries it, which is what lets a damage-only spell fire N times.
		if ((spec.times ?? 1) > 1) this.insertPill(0, countPill(spec.times ?? 1));
	};

	/**
	 * Give the dice tray its damage half — the second line, built from the parts a roll site already
	 * knows. Separate from `prefill` because an attack arrives in two calls (the to-hit opens the
	 * tray, the damage is queued right after), and because THIS is what closes UBUG-21: the damage
	 * used to be queued out of sight and unadjustable, so a "+1d6" typed for a damage rider landed on
	 * the d20 and the card resolved a silently-wrong number.
	 */
	setDamage = (parts: DamagePartSpec[]): void => {
		const real = parts.filter((p) => dealsDamage([p])); // one predicate, not two spellings of it
		const line: RollerLine = {
			...emptyLine(ROLLER_ROLE.damage),
			pills: real.flatMap((p) =>
				pillsFromPool(p.dice, p.mod, {
					...(p.type ? { type: p.type } : {}),
					...(p.mods ? { mods: p.mods } : {}),
					...(p.bonusDice?.length ? { bonusDice: p.bonusDice } : {}),
				}),
			),
		};
		if (!real.length) return;
		const at = this.lines.findIndex((l) => l.role === ROLLER_ROLE.damage);
		this.lines = at >= 0 ? this.lines.map((l, i) => (i === at ? line : l)) : [...this.lines, line];
		this.drafts = this.lines.map((_, i) => this.drafts[i] ?? '');
	};

	/** The damage the lines currently describe, as the specs a roll throws. Exposed because a surface
	 *  may have to roll ONE of them again (Savage Attacker rerolls the weapon's part). */
	get damageSpecs(): DamagePartSpec[] {
		return damageSpecsOf(this.lines, this.critMethod);
	}

	/**
	 * Roll it. Answers with the completed entries — one per instance of a volley — and records
	 * nothing itself: what to do with a roll (log it, toast it, persist it) belongs to the surface
	 * the dice tray is mounted on, not to the dice tray.
	 *
	 * Half-typed text is committed first, so pressing Roll can never quietly leave a token out of the
	 * roll it was typed into. Empty when the lines are unrollable, which the button already shows.
	 */
	roll = (rng?: Rng): RollLogEntry[] => {
		this.commit(this.focus);
		if (!this.rollable) return [];
		return rollLines(
			{
				lines: this.lines,
				label: this.label,
				labelKey: this.labelKey,
				...(this.labelValues ? { labelValues: this.labelValues } : {}),
				note: this.note,
				critMethod: this.critMethod,
			},
			rng,
		);
	};
}
