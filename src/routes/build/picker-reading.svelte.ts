/*
 * Reading an option, and reaching one with the keyboard — the half the grid and the sectioned list
 * had each written for themselves.
 *
 * Both pickers answer the same two questions: which option is the article card up for, and where do
 * the arrow keys go. They differ only in how they LAY OUT their options, so the answers live here
 * and each component keeps its own markup.
 *
 * The keyboard contract this enforces (ui.md §5) is the one a split brain gets wrong: the caret
 * stays in the search box, the highlight is what the arrows move, and the two must never point at
 * different rows. An option is a real `<button>`, so it can also be tabbed to and hold focus — and
 * a walk started from there hands the caret back to the search box rather than leaving a focus ring
 * on one option while Enter takes another.
 */
import { walkOptions, optionDomId } from './option-walk';

/** What the walk needs from the picker around it, read fresh on every key. */
export interface PickerReadingHost {
	/** The options the keyboard can reach, in rendered order. A sectioned list passes only what is
	 *  on screen: a collapsed section is not somewhere the keyboard can land. */
	ids: string[];
	previewId: string | null;
	onpreview: (id: string) => void;
	/** Anything the picker must put away when the full card opens (the sectioned list's hover teaser
	 *  stands down for it). */
	onopen?: () => void;
	/** What Enter does, when it is not "open the article". A language has nothing to read, so there
	 *  Enter takes the row outright — the same thing a click on it does. */
	onenter?: (id: string) => void;
}

export class PickerReading {
	/**
	 * `uid` scopes the DOM ids to ONE picker. The spell pane renders a picker per caster class, so a
	 * shared id would have two lists claiming the same name and `aria-activedescendant` pointing at
	 * whichever the document happened to hold first.
	 */
	constructor(
		private host: () => PickerReadingHost,
		private uid: string,
	) {}

	/** The search input, so a walk started on an option can hand the caret back to it. */
	search = $state<HTMLInputElement | null>(null);
	/** Is the article card up? It always reads the highlighted option, so the highlight and the card
	 *  can never disagree about which option is being talked about. */
	reading = $state(false);

	get listId(): string {
		return `${this.uid}-options`;
	}
	optionId = (effectiveId: string): string => optionDomId(this.uid, effectiveId);
	/** The DOM id the search box points `aria-activedescendant` at, or nothing when the list is not
	 *  showing the highlighted option (a filtered-out or collapsed row). */
	activeId = $derived.by<string | undefined>(() => {
		const { ids, previewId } = this.host();
		return previewId && ids.includes(previewId) ? this.optionId(previewId) : undefined;
	});

	/** Read an option; reading the one already open puts the card away. Never commits anything. */
	read = (id: string): void => {
		const host = this.host();
		if (this.reading && id === host.previewId) {
			this.reading = false;
			return;
		}
		host.onopen?.();
		host.onpreview(id);
		this.reading = true;
	};
	close = () => (this.reading = false);

	/** ↑/↓/Home/End/Enter from the search box — Enter does to the highlighted option whatever a click
	 *  on it would, which is reading it unless the picker says otherwise. */
	fromSearch = (event: KeyboardEvent): boolean => {
		const host = this.host();
		return walkOptions(event, { ...host, onenter: host.onenter ?? this.read });
	};

	/**
	 * The same walk from an option that holds focus. Enter is deliberately left to the browser — the
	 * focused button's own click is the right answer there — and any key that moves the highlight
	 * moves the caret back to the search box, so the focus ring never sits on a row the highlight
	 * has left.
	 */
	fromOptions = (event: KeyboardEvent): void => {
		if (walkOptions(event, this.host())) this.search?.focus();
	};
}
