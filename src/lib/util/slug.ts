/**
 * Turn a human name into an id-safe slug: lowercase, every run of non-alphanumerics collapsed to a
 * single UNDERSCORE, and leading/trailing underscores trimmed. Returns '' when nothing slug-able
 * remains, so each caller can pick its own fallback (a content id falls back differently from a
 * character folder name). Shared so the content-authoring id-slug and the character save-slug can
 * never drift apart. snake_case (E3): `-` is the L2 minus operator, so an id that could enter an
 * expression must not contain it.
 */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '');
}
