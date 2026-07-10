/**
 * Turn a human name into a URL/id-safe slug: lowercase, every run of non-alphanumerics collapsed to a
 * single dash, and leading/trailing dashes trimmed. Returns '' when nothing slug-able remains, so each
 * caller can pick its own fallback (a content id falls back differently from a character folder name).
 * Shared so the content-authoring id-slug and the character save-slug can never drift apart.
 */
export function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
