/*
 * Bundled themes — well-known community palettes (Dracula, Catppuccin) mapped onto Charnik's semantic
 * tokens, shipped WITH the app as first-class selectable themes alongside the built-in dark/light.
 * They're registered with the injector at startup (so `[data-theme=id]` exists) and listed in
 * Settings ▸ Themes for direct activation; users can Clone one to make their own editable copy.
 *
 * Palette credits: Dracula (draculatheme.com, MIT) · Catppuccin (github.com/catppuccin, MIT).
 */
import type { CustomTheme } from './customThemes';

/** Dracula — the classic dark purple/pink palette. */
const DRACULA: CustomTheme = {
	id: 'dracula',
	name: 'Dracula',
	tokens: {
		'color-bg': '#282a36',
		'color-surface': '#2f313f',
		'color-surface-2': '#3a3d4e',
		'color-border': '#44475a',
		'color-border-strong': '#565971',
		'color-text': '#f8f8f2',
		'color-text-muted': '#6272a4',
		'color-accent': '#bd93f9',
		'color-accent-text': '#282a36',
		'color-accent-bright': '#ff79c6',
		'color-accent-deep': '#bd93f9',
		'color-accent-soft': '#322a44',
		'color-resource': '#f1fa8c',
		'color-resource-soft': '#34331d',
		'color-resource-line': '#6b6a3a',
		'color-good': '#50fa7b',
		'color-good-soft': '#1e3a26',
		'color-good-line': '#2f5a3a',
		'color-success': '#50fa7b',
		'color-warning': '#ffb86c',
		'color-warning-text': '#282a36',
		'color-danger': '#ff5555',
		'color-danger-soft': '#3a1f22',
		'color-overlay': 'rgb(0 0 0 / 0.6)',
		'shadow-1': '0 1px 2px rgb(0 0 0 / 0.4)',
		'shadow-2': '0 8px 30px rgb(0 0 0 / 0.55)'
	}
};

/** Catppuccin Mocha — the soft pastel dark palette. */
const CATPPUCCIN_MOCHA: CustomTheme = {
	id: 'catppuccin-mocha',
	name: 'Catppuccin Mocha',
	tokens: {
		'color-bg': '#1e1e2e',
		'color-surface': '#28283a',
		'color-surface-2': '#313244',
		'color-border': '#45475a',
		'color-border-strong': '#585b70',
		'color-text': '#cdd6f4',
		'color-text-muted': '#a6adc8',
		'color-accent': '#cba6f7',
		'color-accent-text': '#1e1e2e',
		'color-accent-bright': '#f5c2e7',
		'color-accent-deep': '#cba6f7',
		'color-accent-soft': '#2c2740',
		'color-resource': '#f9e2af',
		'color-resource-soft': '#34321f',
		'color-resource-line': '#6b6640',
		'color-good': '#a6e3a1',
		'color-good-soft': '#21371f',
		'color-good-line': '#33553a',
		'color-success': '#a6e3a1',
		'color-warning': '#fab387',
		'color-warning-text': '#1e1e2e',
		'color-danger': '#f38ba8',
		'color-danger-soft': '#3a2029',
		'color-overlay': 'rgb(0 0 0 / 0.6)',
		'shadow-1': '0 1px 2px rgb(0 0 0 / 0.4)',
		'shadow-2': '0 8px 30px rgb(0 0 0 / 0.55)'
	}
};

/** Catppuccin Latte — the light member of the Catppuccin family. */
const CATPPUCCIN_LATTE: CustomTheme = {
	id: 'catppuccin-latte',
	name: 'Catppuccin Latte',
	tokens: {
		'color-bg': '#eff1f5',
		'color-surface': '#ffffff',
		'color-surface-2': '#e6e9ef',
		'color-border': '#ccd0da',
		'color-border-strong': '#bcc0cc',
		'color-text': '#4c4f69',
		'color-text-muted': '#6c6f85',
		'color-accent': '#8839ef',
		'color-accent-text': '#ffffff',
		'color-accent-bright': '#8839ef',
		'color-accent-deep': '#8839ef',
		'color-accent-soft': '#f3e9fb',
		'color-resource': '#df8e1d',
		'color-resource-soft': '#f6ecd6',
		'color-resource-line': '#d3b877',
		'color-good': '#40a02b',
		'color-good-soft': '#dcf0d6',
		'color-good-line': '#a6d29a',
		'color-success': '#40a02b',
		'color-warning': '#df8e1d',
		'color-warning-text': '#ffffff',
		'color-danger': '#d20f39',
		'color-danger-soft': '#f7dde1',
		'color-overlay': 'rgb(0 0 0 / 0.3)',
		'shadow-1': '0 1px 2px rgb(0 0 0 / 0.08)',
		'shadow-2': '0 10px 30px rgb(0 0 0 / 0.12)'
	}
};

/** Themes shipped with the app — selectable directly, like the built-in dark/light. */
export const BUNDLED_THEMES: readonly CustomTheme[] = [DRACULA, CATPPUCCIN_MOCHA, CATPPUCCIN_LATTE];
