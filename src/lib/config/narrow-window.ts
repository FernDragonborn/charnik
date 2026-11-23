/** Where the app's narrow layout starts (`docs/internals/ui.md` ▸ A narrow window): one width, so
 *  the warning, the layout's own rules and the parts that change place agree on it. CSS cannot read a
 *  custom property inside a media condition, so the stylesheets spell the same 800px. */
export const NARROW_WINDOW_QUERY = '(max-width: 800px)';

/** A finger rather than a mouse — what tells a phone from a desktop window dragged small
 *  (`work/play-layout.md` ▸ LAYOUT-WIDTHS, the maintainer's call): the pointer, not the width. */
export const FINGER_QUERY = '(pointer: coarse)';

/** Below this a mouse-driven play screen deals its panels into columns of tabs
 *  (`work/play-layout.md` ▸ NARROW-DESKTOP); the mock is drawn at 512 and 768. */
export const COLUMNS_WINDOW_QUERY = '(max-width: 1023px)';

/** Wide enough for three columns of tabs rather than two. */
export const THREE_COLUMNS_QUERY = '(min-width: 760px)';
