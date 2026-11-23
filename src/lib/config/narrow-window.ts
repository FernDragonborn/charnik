/** Where the app's narrow layout starts (`docs/internals/ui.md` ▸ A narrow window): one width, so
 *  the warning, the layout's own rules and the parts that change place agree on it. CSS cannot read a
 *  custom property inside a media condition, so the stylesheets spell the same 800px. */
export const NARROW_WINDOW_QUERY = '(max-width: 800px)';
