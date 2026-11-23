import { resolve } from '$app/paths';

/** The prefix the app is served under: '' on the desktop, the repository's path on GitHub Pages.
 *  SvelteKit 3 keeps it behind `resolve()`, which answers `<base>/` for the root; the few places that
 *  join paths themselves (the bundled content's fetch root, a compendium entry's path) take it here. */
export const BASE_PATH = resolve('/').slice(0, -1);
