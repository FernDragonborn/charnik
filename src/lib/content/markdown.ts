// Render user-owned CSV prose (Markdown and/or raw HTML) to a SANITIZED HTML string.
// Content is user-authored (homebrew CSVs), so it may carry injected <script>/on*/javascript: —
// marked parses it, then DOMPurify strips anything that could run. The single source of this
// pipeline: both the compendium article body (ArticleProse) and the combat effect ⓘ text
// (PanelCard) go through here so formatting + sanitization stay identical (UBUG-7).
import DOMPurify from 'dompurify';
import { marked } from 'marked';

/** The classes the renderer below adds itself — the only ones prose may carry. */
const RENDERER_CLASSES: readonly string[] = ['prose-break', 'prose-table-scroll'];

/**
 * What prose may NOT carry, on top of DOMPurify's defaults. The defaults stop script; they keep
 * markup that deceives — a `<form>` posting a typed password to a stranger, a `<style>` element or a
 * `style` attribute drawing over the app's own dialogs — and that is as much a way to hurt a reader
 * as code is. Prose needs none of it: emphasis, lists, tables and links are the whole vocabulary.
 *
 * `data-*` goes because the app's own scripts read data attributes and prose has no business
 * setting one. `srcset` goes whole: it is a list of sources, and the rule about sources below is
 * about one. `background` goes whole too: DOMPurify keeps the legacy attribute, a browser still
 * fetches it as an image on a table or a cell, and prose has no use for a picture behind a table.
 */
const PROSE_POLICY = {
	FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option'],
	FORBID_ATTR: ['style', 'srcset', 'background'],
	ALLOW_DATA_ATTR: false,
};

/** The attributes that make an element FETCH something. A link's `href` is not one: following it is
 *  the reader's own act, and `util/links.ts` decides where it opens. */
const FETCHING_ATTRIBUTES: readonly string[] = ['src', 'poster', 'href', 'xlink:href'];
const LINK_TAG = 'A';

/** May prose load this? Only what travels with the page: an inline `data:` image, or a path on the
 *  app's own origin. A remote source is a request to a stranger's server the moment the row is read
 *  — who opened which article, and when — whatever the page's CSP says today. */
function isOwnSource(value: string): boolean {
	const url = value.trim();
	if (/^data:/i.test(url)) return true;
	try {
		return new URL(url, window.location.href).origin === window.location.origin;
	} catch {
		// not a URL the browser can resolve, so not one it can fetch either
		return false;
	}
}

// One hook for the two rules a tag or attribute list cannot say: a class is kept only if the
// renderer wrote it, and a fetching attribute only if what it names is the page's own.
if (DOMPurify.isSupported)
	DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
		if (data.attrName === 'class') {
			const kept = data.attrValue.split(/\s+/).filter((name) => RENDERER_CLASSES.includes(name));
			data.attrValue = kept.join(' ');
			data.keepAttr = kept.length > 0;
		} else if (FETCHING_ATTRIBUTES.includes(data.attrName) && node.nodeName !== LINK_TAG) {
			data.keepAttr = isOwnSource(data.attrValue);
		}
	});

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
	return sanitize(
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
