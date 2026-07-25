/**
 * The sandbox guard shared by every `Storage` impl: normalize a caller-supplied path to
 * `/`-separated, root-relative form and REJECT traversal so nothing can read/write outside the
 * data root through the seam.
 *
 * Backslashes are normalized to `/` BEFORE splitting — otherwise a Windows-style `..\x` stays a
 * single segment under a `/`-only split, hides its `..`, and `join`/`resolve` then escapes the
 * root (audit S1). The Tauri fs-scope capability is a second line of defence, but the seam's own
 * validation is what the node/in-memory impls rely on entirely, so it must be correct here.
 */
export function sandboxRelative(path: string): string {
	const parts = path
		.replace(/\\/g, '/')
		.split('/')
		.filter((s) => s && s !== '.');
	if (parts.includes('..')) throw new Error(`path escapes storage root: ${path}`);
	return parts.join('/');
}
