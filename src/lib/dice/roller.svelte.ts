/*
 * The roller ORGAN's live state: the lines, where the caret is, what is half-typed, which suggestion
 * is selected, and what pressing Roll does. The UI (`Roller.svelte`) binds to this and holds no state
 * of its own; the rules of the model live in `roller.ts`, which is pure.
 *
 * It knows nothing about the content graph or the active locale: the host hands it `candidates`
 * (built by `roller-vocabulary.ts`) and reads back the completed rolls. That is what lets the dev
 * preview drive the real organ with a fixture vocabulary, and it is why the same organ can be an
 * ad-hoc roll (an empty body) and a prefilled attack without a mode flag telling them apart.
 */
import { app } from '$lib/stores/app.svelte';
import { rollDamageParts, type DamagePartSpec, type RollLogEntry } from '$lib/combat/roll';
import {
	ADVANTAGE_MODE,
	CRIT_METHOD,
	rollPool,
	type AdvantageMode,
	type BonusDie,
	type CritMethod,
	type DieMods,
	type Rng,
} from '$lib/rules/dice';
import { signed } from '$lib/util/format';
import {
	PILL_KIND,
	ROLLER_ROLE,
	TOKEN_KIND,
	addToken,
	canRoll,
	damageParts,
	emptyLine,
	normalizeLine,
	pillsFromPool,
	rollerIssues,
	testRoll,
	volleyOf,
	type RollerLine,
	type RollerPill,
} from './roller';
import { candidateResolver, matchCandidates, type RollerCandidate } from './roller-vocabulary';

/** What a caller hands the organ to build a roll it already knows about (an attack row, a spell).
 *  Both halves are optional and independent: a check is a test with no damage, a Fireball is damage
 *  with no test — the target saves, not you (§3). */
export interface RollerPrefill {
	label: string;
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
	/** Provenance recorded with the roll — an upcast's "8d6 base + 1d6 @ slot 4". */
	note?: string;
}

/** The caret is in the LINE, not in the suggestion menu. `↓` moves it in, `↑` off the top row moves
 *  it back — so there is one selection, not a line selection and a menu selection at once. */
const IN_LINE = -1;

export class RollerOrgan {
	/** What the roll is for ("Greataxe"). Empty for an ad-hoc roll. */
	label = $state('');
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
	/** What the lines can be told by name. The host owns this; the organ only reads it. */
	candidates = $state<RollerCandidate[]>([]);
	/** Per-roll override of the crit method, or null to follow the app setting. The table rules on
	 *  this mid-session as often as it sets it once, so it is reachable from the tray (PLAN §9). */
	critOverride = $state<CritMethod | null>(null);

	/** Esc closes the menu and leaves the text alone; typing anything opens it again. A flag rather
	 *  than an empty menu, because the matches are still there — it is the OFFER that was declined. */
	private dismissed = $state(false);

	private resolver = $derived(candidateResolver(this.candidates));
	draft = $derived(this.drafts[this.focus] ?? '');
	critMethod = $derived(this.critOverride ?? app.critMethod);

	/** The suggestion list for what is being typed. Open the moment the token has a LETTER — digits
	 *  and `d` belong to the dice parser and must not raise a menu over a `2d6` in progress. */
	menu = $derived(
		!this.dismissed && /\p{L}/u.test(this.draft)
			? matchCandidates(this.draft, this.candidates)
			: [],
	);

	/** Which row is highlighted. The top row is highlighted from the start — that is what the ghost
	 *  hint is previewing — so `selected` says whether the CARET moved into the menu, not whether
	 *  anything is chosen. */
	highlight = $derived(
		this.menu.length ? Math.max(0, Math.min(this.selected, this.menu.length - 1)) : IN_LINE,
	);
	inMenu = $derived(this.selected !== IN_LINE && this.menu.length > 0);

	/** The grey completion drawn inline, editor style: the rest of the highlighted row's name, then
	 *  what it would insert. So what Tab does is legible before Tab. */
	ghost = $derived.by(() => {
		const top = this.menu[this.highlight];
		if (!top) return '';
		const rest = top.at === 0 ? top.candidate.label.slice(this.draft.length) : '';
		return `${rest} → ${top.candidate.preview || top.candidate.label}`;
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
	}

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
		if (this.menu.length) this.selected = Math.min(this.selected + 1, this.menu.length - 1);
	};
	selectUp = (): void => {
		this.selected = this.selected <= 0 ? IN_LINE : this.selected - 1;
	};
	dismissMenu = (): void => {
		this.dismissed = true;
		this.selected = IN_LINE;
	};

	/** Commit a finished token into a line. */
	private commitText(index: number, text: string): void {
		const line = this.lineAt(index);
		if (!line || !text.trim()) return;
		this.replace(index, addToken(line, text, this.resolver));
	}

	/** Take a suggestion: the pill lands in the line and the caret comes out the far side of it, which
	 *  is what Tab, Enter and a click all do (§6 — they are one act, not three). */
	pick = (index: number, candidate: RollerCandidate): void => {
		const line = this.lineAt(index);
		if (!line) return;
		if (candidate.insert.kind === TOKEN_KIND.advantage)
			this.replace(index, { ...line, advantage: candidate.insert.mode });
		else if (candidate.insert.kind === TOKEN_KIND.pill)
			this.replace(
				index,
				normalizeLine({ ...line, pills: [...line.pills, candidate.insert.pill] }),
			);
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

	/** Backspace against the left edge of the caret: unfold the last pill back into text, caret at its
	 *  end. The pill keeps the token it was made from precisely so this is lossless. */
	unfoldLast = (index: number): void => {
		const line = this.lineAt(index);
		if (!line || (this.drafts[index] ?? '') !== '' || !line.pills.length) return;
		const last = line.pills[line.pills.length - 1];
		if (!last) return;
		this.replace(index, normalizeLine({ ...line, pills: line.pills.slice(0, -1) }));
		this.setDraft(index, last.text);
	};

	/** Unfold any pill — what a double-click does ("Bless → Bane" without retyping). */
	unfold = (index: number, pillIndex: number): void => {
		const line = this.lineAt(index);
		const pill = line?.pills[pillIndex];
		if (!line || !pill) return;
		this.replace(
			index,
			normalizeLine({ ...line, pills: line.pills.filter((_, i) => i !== pillIndex) }),
		);
		this.setDraft(index, pill.text);
	};

	removePill = (index: number, pillIndex: number): void => {
		const line = this.lineAt(index);
		if (!line) return;
		this.replace(
			index,
			normalizeLine({ ...line, pills: line.pills.filter((_, i) => i !== pillIndex) }),
		);
	};

	/** Nudge a pill's quantity — the −/+ that appear on hover and the wheel over it. They exist
	 *  because clicking the NUMBER has to stay a caret placement, or there is no way into a pill with
	 *  a mouse at all (§4). A dice pill counts dice, a flat pill counts itself. */
	bumpPill = (index: number, pillIndex: number, delta: number): void => {
		const line = this.lineAt(index);
		const pill = line?.pills[pillIndex];
		if (!line) return;
		let next: RollerPill;
		if (pill?.kind === PILL_KIND.dice) {
			const count = pill.count + delta;
			if (count < 1) return this.removePill(index, pillIndex);
			next = { ...pill, count, text: `${count}d${pill.sides}` };
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
		this.lines = this.lines.map((l, i) =>
			i === from
				? normalizeLine({ ...l, pills: l.pills.filter((_, k) => k !== pillIndex) })
				: i === to
					? normalizeLine({ ...l, pills: [...l.pills, pill] })
					: l,
		);
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
		const next =
			line.advantage === ADVANTAGE_MODE.neither
				? ADVANTAGE_MODE.advantage
				: line.advantage === ADVANTAGE_MODE.advantage
					? ADVANTAGE_MODE.disadvantage
					: ADVANTAGE_MODE.neither;
		this.replace(index, { ...line, advantage: next });
	};

	toggleCrit = (index: number): void => {
		const line = this.lineAt(index);
		if (line) this.replace(index, { ...line, crit: !line.crit });
	};

	cycleCritMethod = (): void => {
		this.critOverride =
			this.critMethod === CRIT_METHOD.classic ? CRIT_METHOD.loyal : CRIT_METHOD.classic;
	};

	/** A damage line, added on demand. */
	addDamageLine = (): void => {
		this.lines = [...this.lines, emptyLine(ROLLER_ROLE.damage)];
		this.drafts = [...this.drafts, ''];
		this.focus = this.lines.length - 1;
	};

	reset = (): void => {
		this.label = '';
		this.note = '';
		this.lines = [emptyLine(ROLLER_ROLE.test)];
		this.drafts = [''];
		this.focus = 0;
		this.selected = IN_LINE;
		this.critOverride = null;
	};

	/** Build the organ for a roll the app already knows about. The second line exists only when there
	 *  IS damage — which is the whole rule for when a roller has two lines (§3). */
	prefill = (spec: RollerPrefill): void => {
		this.reset();
		this.label = spec.label;
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
		this.focus = 0;
		if (spec.damage?.length) this.setDamage(spec.damage);
		// neither half — an ad-hoc roll is still this organ, with an empty line to type into. The
		// fallback runs AFTER the damage, or a damage-only roll would be given a test line it has no
		// use for (an advantage toggle and a to-hit total on a Fireball).
		if (!this.lines.length) {
			this.lines = [emptyLine(ROLLER_ROLE.test)];
			this.drafts = [''];
		}
	};

	/**
	 * Give the organ its damage half — the second line, built from the parts a roll site already
	 * knows. Separate from `prefill` because an attack arrives in two calls (the to-hit opens the
	 * tray, the damage is queued right after), and because THIS is what closes UBUG-21: the damage
	 * used to be queued out of sight and unadjustable, so a "+1d6" typed for a damage rider landed on
	 * the d20 and the card resolved a silently-wrong number.
	 */
	setDamage = (parts: DamagePartSpec[]): void => {
		const real = parts.filter((p) => Object.keys(p.dice).length || p.mod);
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

	/**
	 * Roll it. Answers with the completed entries — one per instance of a volley — and records
	 * nothing itself: what to do with a roll (log it, toast it, persist it) belongs to the surface
	 * the organ is mounted on, not to the organ.
	 *
	 * Half-typed text is committed first, so pressing Roll can never quietly leave a token out of the
	 * roll it was typed into. Empty when the lines are unrollable, which the button already shows.
	 */
	roll = (rng?: Rng): RollLogEntry[] => {
		this.commit(this.focus);
		if (!this.rollable) return [];
		const test = this.lines.find((l) => l.role === ROLLER_ROLE.test && l.pills.length);
		const spec = test ? testRoll(test) : null;
		const parts = this.lines
			.filter((l) => l.role === ROLLER_ROLE.damage)
			.flatMap((line) =>
				damageParts(line).map((p) => (line.crit ? { ...p, crit: this.critMethod } : p)),
			);
		const times = test ? volleyOf(test) : 1;
		const at = Date.now();
		const out: RollLogEntry[] = [];
		for (let i = 0; i < times; i++) {
			const primary = rollPool(spec?.dice ?? {}, {
				mod: spec?.mod ?? 0,
				advantage: spec?.advantage ?? 0,
				...(spec?.bonusDice.length ? { bonusDice: spec.bonusDice } : {}),
				...(spec?.mods ?? {}),
				...(rng ? { rng } : {}),
			});
			const damage = parts.length ? rollDamageParts(parts, rng) : undefined;
			out.push({
				label: this.label || 'Custom roll',
				...primary,
				...(damage ? { damage } : {}),
				...(this.note ? { note: this.note } : {}),
				// one instance per millisecond: `at` is what an amendment matches on to rewrite ITS line,
				// so a volley whose three attacks shared a timestamp would rewrite the wrong one
				at: at + i,
			});
		}
		return out;
	};
}
