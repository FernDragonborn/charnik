// Render user-owned CSV prose (Markdown and/or raw HTML) to a SANITIZED HTML string.
// Content is user-authored (homebrew CSVs), so it may carry injected <script>/on*/javascript: —
// marked parses it, then DOMPurify strips anything that could run. The single source of this
// pipeline: both the compendium article body (ArticleProse) and the combat effect ⓘ text
// (PanelCard) go through here so formatting + sanitization stay identical (UBUG-7).
import DOMPurify from 'dompurify';
import { marked } from 'marked';

// Some content mixes Markdown with raw HTML tables. marked won't process Markdown that sits
// inside/right after an HTML block, so: force blank lines around <table> (so the following text
// parses as Markdown), then mop up emphasis left literal inside table cells.
export function renderContentMarkdown(md: string): string {
	const spaced = md.replace(/\n*(<table>)/g, '\n\n$1').replace(/(<\/table>)\n*/g, '$1\n\n');
	// breaks: a single newline → <br>. CSV cells (condition/item/feat text) use `•` + hard newlines
	// for line-per-bullet layout that isn't Markdown list syntax; without this they'd collapse to one
	// line. Paragraphs stay blank-line separated, so prose is unaffected.
	let html = marked.parse(spaced, { async: false, breaks: true }) as string;
	html = html
		.replace(/\*\*([^*<>\n]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\*([^*<>\n]+)\*/g, '<em>$1</em>');
	return DOMPurify.sanitize(html);
}
