// Render user-owned CSV prose (Markdown and/or raw HTML) to a SANITIZED HTML string.
// Content is user-authored (homebrew CSVs), so it may carry injected <script>/on*/javascript: —
// marked parses it, then DOMPurify strips anything that could run. The single source of this
// pipeline: both the compendium article body (ArticleProse) and the combat effect ⓘ text
// (PanelCard) go through here so formatting + sanitization stay identical (UBUG-7).
import DOMPurify from 'dompurify';
import { marked } from 'marked';

/**
 * What prose may NOT carry, on top of DOMPurify's defaults. The defaults stop script; they keep
 * markup that deceives — a `<form>` posting a typed password to a stranger, a `<style>` element or a
 * `style` attribute drawing over the app's own dialogs — and that is as much a way to hurt a reader
 * as code is. Prose needs none of it: emphasis, lists, tables and links are the whole vocabulary.
 * `class` stays because the renderer below adds its own.
 */
const PROSE_POLICY = {
	FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option'],
	FORBID_ATTR: ['style'],
};
const sanitize = (html: string): string => DOMPurify.sanitize(html, PROSE_POLICY);

// Some content mixes Markdown with raw HTML tables. marked won't process Markdown that sits
// inside/right after an HTML block, so: force blank lines around <table> (so the following text
// parses as Markdown), then mop up emphasis left literal inside table cells.
export function renderContentMarkdown(md: string): string {
	const spaced = md.replace(/\n*(<table>)/g, '\n\n$1').replace(/(<\/table>)\n*/g, '$1\n\n');
	// breaks: a single newline → <br>. CSV cells (condition/item/feat text) use `•` + hard newlines
	// for line-per-bullet layout that isn't Markdown list syntax; without this they'd collapse to one
	// line. Paragraphs stay blank-line separated, so prose is unaffected.
	let html = marked.parse(spaced, { async: false, breaks: true });
	html = html
		.replace(/\*\*([^*<>\n]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\*([^*<>\n]+)\*/g, '<em>$1</em>')
		// A table is one of the few blocks allowed to be wider than the column it sits in, and it gets
		// its OWN scroller rather than pushing the page sideways (`AGENTS.md` ▸ Hit every surface).
		// Wrapped here rather than styled `display: block`, which would also stop it filling its column
		// on a wide screen: this leaves every existing rendering untouched and only adds the scroll.
		// A hard break carries two different meanings in this content: the source separates paragraphs
		// with a SINGLE newline ("Prerequisites." on its own line, a `•` bullet per line), and it also
		// wraps a long sentence. Only the first deserves air, so only a break that follows the end of a
		// sentence gets it — a break mid-sentence is a wrapping artifact and stays tight. The air is an
		// ELEMENT because a <br> takes no margin in any browser: display, line-height and ::before all
		// measure zero.
		.replace(/([.!?:”’"')\]])(<br\s*\/?>)/g, '$1$2<span class="prose-break"></span>')
		.replace(/<table>/g, '<div class="prose-table-scroll"><table>')
		.replace(/<\/table>/g, '</table></div>');
	return sanitize(html);
}

/**
 * The same pipeline for a fragment that must stay INLINE — a spell's "at higher levels" line, its
 * material component. Both carry Markdown in the SRD (`create_undead` has `**Ghouls**`), and both
 * used to be interpolated as plain text, so the syntax showed literally. `parseInline` skips the
 * block grammar, so no stray `<p>` lands inside a one-line callout.
 */
export function renderContentMarkdownInline(md: string): string {
	const html = marked.parseInline(md, { async: false });
	return DOMPurify.sanitize(
		html
			.replace(/\*\*([^*<>\n]+)\*\*/g, '<strong>$1</strong>')
			.replace(/\*([^*<>\n]+)\*/g, '<em>$1</em>'),
	);
}

/** Sanitize a raw HTML string (no Markdown pass) — DOMPurify keeps safe inline tags like <b>/<em> and
 *  strips anything executable (<script>, on* handlers, javascript:). The shared seam for `{@html …}`
 *  of any string that could be user-authored — incl. i18n catalog strings, since a user can drop in a
 *  new locale JSON at runtime (the i18n invariant), so those are NOT trusted (ARCH-3). */
export function sanitizeHtml(html: string): string {
	return sanitize(html);
}
