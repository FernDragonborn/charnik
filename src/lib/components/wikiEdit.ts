/*
 * Shared types for the WikiDetail family (dispatcher + per-type heads + ArticleProse). Kept in a
 * plain module (not a component) so every piece can import the draft/mode without a component cycle.
 */

/** In edit (translate) mode, the raw TARGET-locale prose being edited — bound in place; the parent owns
 *  the `$state` object. Only prose is editable; structural stats stay read-only. Empty fields show the
 *  source (the read-only, en-fallback `detail`) as a placeholder. `higher_level` keeps the CSV base. */
export interface WikiEditDraft {
	name: string;
	text: string;
	material?: string;
	higher_level?: string;
}

/** How a head renders. `read` = static; `translate` = prose editable (title/body/…), stats read-only;
 *  `editor` (future) = structural fields become widgets too. This pass implements read + translate;
 *  `editor` is reserved so the seam exists. */
export type DetailMode = 'read' | 'translate' | 'editor';
