// Test stub for SvelteKit's `$app/paths` virtual module (aliased in vitest.config.ts): served at
// the root, as the desktop app is.
export const resolve = (path: string): string => (path.startsWith('/') ? path : `/${path}`);
export const asset = (file: string): string => `/${file}`;
