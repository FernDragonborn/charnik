/*
 * The one way anything reaches a toast. One action says one toast: everything said in the same task
 * — a roll and the notice the cast left, a failed save and its card — is gathered and shown as ONE
 * card, and the next thing said replaces it. Two toasts on screen at once was a stack where the older
 * stood collapsed behind the newer, unreadable until hovered (ui.md ▸ rule 20). Imports of
 * `svelte-sonner` anywhere else are refused by the linter, so the rule cannot be walked around.
 */
import { toast as sonner } from 'svelte-sonner';
import RollToast from '$lib/components/RollToast.svelte';
import type { RollToastModel } from '$lib/dice/roll-toast';

export const TOAST_TONE = {
	plain: 'plain',
	success: 'success',
	warning: 'warning',
	error: 'error',
} as const;
export type ToastTone = (typeof TOAST_TONE)[keyof typeof TOAST_TONE];

export interface ToastOptions {
	description?: string;
	/** Names a notice that must not be said twice: a later one with the same key replaces it. */
	id?: string;
	/** `Infinity` makes the notice STANDING — it rides every card after it until dismissed. */
	duration?: number;
}

/** A sentence on a card — what a notice toast says, and what a roll's card carries under the roll. */
export interface ToastNote {
	tone: ToastTone;
	title: string;
	description?: string;
}

interface NotePart extends ToastNote {
	key?: string;
	standing: boolean;
}

/** What one action has said so far, and the card on screen with the standing notes it carries. */
const said: { rolls: RollToastModel[]; notes: NotePart[] } = { rolls: [], notes: [] };
let shown: { id: string; standing: NotePart[] } | null = null;
let flushQueued = false;

function queueFlush(): void {
	if (flushQueued) return;
	flushQueued = true;
	// a macrotask, not a microtask: an action that awaits a settled promise between its roll and its
	// notice is still one action
	setTimeout(flush, 0);
}

/** Later wins: a keyed notice said again replaces the earlier one in place of appearing twice. */
function withoutRepeats(notes: NotePart[]): NotePart[] {
	const last = new Map<string, number>();
	notes.forEach((note, index) => note.key !== undefined && last.set(note.key, index));
	return notes.filter((note, index) => note.key === undefined || last.get(note.key) === index);
}

function flush(): void {
	flushQueued = false;
	const rolls = said.rolls;
	const notes = withoutRepeats([...(shown?.standing ?? []), ...said.notes]);
	said.rolls = [];
	said.notes = [];
	if (shown) sonner.dismiss(shown.id);

	const id = crypto.randomUUID();
	const standing = notes.filter((note) => note.standing);
	const forget = () => {
		if (shown?.id === id) shown = null;
	};
	const options = {
		id,
		onDismiss: forget,
		onAutoClose: forget,
		...(standing.length ? { duration: Infinity } : {}),
	};
	shown = { id, standing };

	const [only] = notes;
	if (rolls.length === 0 && notes.length === 1 && only) {
		const description = only.description === undefined ? {} : { description: only.description };
		if (only.tone === TOAST_TONE.plain) sonner(only.title, { ...options, ...description });
		else sonner[only.tone](only.title, { ...options, ...description });
		return;
	}
	sonner.custom(RollToast, {
		...options,
		componentProps: { models: rolls, notes },
	});
}

function sayNote(tone: ToastTone, title: string, options: ToastOptions = {}): void {
	said.notes.push({
		tone,
		title,
		...(options.description === undefined ? {} : { description: options.description }),
		...(options.id === undefined ? {} : { key: options.id }),
		standing: options.duration === Infinity,
	});
	queueFlush();
}

/** Say a notice. Same call shape as the library's, so a call site reads as it always has. */
export const toast = Object.assign(
	(title: string, options?: ToastOptions) => sayNote(TOAST_TONE.plain, title, options),
	{
		success: (title: string, options?: ToastOptions) => sayNote(TOAST_TONE.success, title, options),
		warning: (title: string, options?: ToastOptions) => sayNote(TOAST_TONE.warning, title, options),
		error: (title: string, options?: ToastOptions) => sayNote(TOAST_TONE.error, title, options),
	},
);

/** Show a completed roll's card — joined by whatever else the same action says. */
export function toastRollCard(model: RollToastModel): void {
	said.rolls.push(model);
	queueFlush();
}
