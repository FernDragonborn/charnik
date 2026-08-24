/*
 * The Combat view's menus: where a dropdown opens, and the one dice-tray seam every roll in the app
 * can reach. Split out of the view-model, which is about the character, not about page geometry.
 *
 * Menus anchor under the button that opened them in DOCUMENT coordinates, so a dropdown scrolls with
 * the page instead of hanging in the viewport. The tray seam is the other half: a generic
 * `openDiceTray({label, formula})` raised anywhere in combat has to arrive at THIS tray (pool,
 * advantage, the attack→damage chain) rather than the instant-roll fallback.
 *
 * The view-model keeps `overlay` / `openMenu` / `openDice` as its own names (§6.1) — every panel and
 * both sibling subsystems are written against them.
 */
import { parseDamageParts, type MenuKind } from '$lib/combat/helpers';
import { registerDiceTray, type DiceTrayRequest } from '$lib/dice/tray.svelte';
import type { RollTray } from './roll-tray.svelte';

/** What the menus need from the sheet around them: somewhere to put a prefilled roll. */
export interface MenuOverlayHost {
	tray: RollTray;
}

/** An open dropdown: which menu, and where it sits in DOCUMENT coordinates. Anchored left OR right
 *  (whichever edge the trigger is nearer), never both. */
export interface OpenOverlay {
	kind: MenuKind;
	top: number;
	left: number | null;
	right: number | null;
}

export class MenuOverlay {
	constructor(private host: () => MenuOverlayHost) {}

	// menus open as dropdowns anchored under their trigger button (not centered modals)
	overlay = $state<OpenOverlay | null>(null);

	openMenu = (kind: MenuKind, e: Event) => {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const anchorRight = r.left > window.innerWidth / 2;
		// document coords (+scroll) so the dropdown scrolls WITH the page/button, not the viewport
		this.overlay = {
			kind,
			top: r.bottom + window.scrollY + 6,
			left: anchorRight ? null : r.left + window.scrollX,
			right: anchorRight ? document.documentElement.clientWidth - r.right : null,
		};
	};

	openDice = (e: Event) => {
		this.host().tray.reset();
		this.openMenu('dice', e);
	};

	/** Open a menu with NO anchor event — a centered dropdown near the top. Used by the D8 tray seam,
	 *  where a request arrives from a generic RollButton that doesn't hand us its DOM node. */
	openMenuCentered = (kind: MenuKind) => {
		if (typeof window === 'undefined') return;
		this.overlay = {
			kind,
			top: window.scrollY + 80,
			left: Math.max(8, window.innerWidth / 2 - 150),
			right: null,
		};
	};

	/** D8: the ONE dice-tray seam, implemented by the rich combat tray. Registered on mount (see
	 *  +page), so a generic `openDiceTray({label, formula})` anywhere in combat opens THIS tray (pool,
	 *  advantage, attack→damage chain) instead of the instant-roll fallback. A caller may pass a
	 *  pre-split `pool`/`mod`; otherwise the formula↔pool adapter (`parseDamageParts`) fills the tray. */
	handleTrayRequest = (req: DiceTrayRequest) => {
		const [parsed] = req.pool ? [] : parseDamageParts(req.formula);
		const pool = req.pool ?? parsed?.pool ?? {};
		const mod = req.mod ?? parsed?.mod ?? 0;
		// A request with no d20 is a QUANTITY, not a verdict: a compendium "8d6 fire" is damage, and a
		// test line would give it an advantage toggle and a to-hit total. Every caller that means a
		// test has a d20 in its pool, so the pool IS the signal — no extra field on the seam.
		if (!pool[20]) {
			this.host().tray.prefillDamage({
				label: req.label,
				parts: [{ dice: pool, mod, type: parsed?.type ?? '' }],
			});
			this.openMenuCentered('dice');
			return;
		}
		this.host().tray.prefill({
			label: req.label,
			dice: pool,
			mod,
			advantage: req.advantage ?? 0,
			mods: req.mods ?? {},
		});
		if (req.queuedDamage)
			this.host().tray.queueDamage({
				label: req.queuedDamage.label,
				parts: [
					{
						dice: req.queuedDamage.dice,
						mod: req.queuedDamage.mod,
						type: '',
						...(req.queuedDamage.mods ? { mods: req.queuedDamage.mods } : {}),
					},
				],
			});
		this.openMenuCentered('dice');
	};

	/** Register this tray as the live `DiceTrayRequest` handler; returns an unregister fn (called on
	 *  combat unmount so leaving the route restores the instant-roll fallback). */
	registerTray = () => registerDiceTray(this.handleTrayRequest);
}
