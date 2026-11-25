import { describe, it, expect, afterEach } from 'vitest';
import { cycleRegion } from './region-cycle';

function mountRegions(): void {
	document.body.innerHTML = `
		<header data-region><button>Roster</button></header>
		<section data-region><button>Attacks</button><button>Greataxe</button></section>
		<section data-region><p>no controls here</p></section>
		<section data-region><button>Spells</button></section>`;
}
const f6 = (shiftKey = false) => {
	const event = new KeyboardEvent('keydown', { code: 'F6', shiftKey, cancelable: true });
	return cycleRegion(event);
};
const at = () => document.activeElement?.textContent?.trim();

describe('F6 between regions (work/ui.md ▸ KEYBOARD-NAV)', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('walks the regions in page order, landing on each one’s first control, and wraps', () => {
		mountRegions();
		expect(f6()).toBe(true);
		expect(at()).toBe('Roster');
		f6();
		expect(at()).toBe('Attacks');
		f6();
		expect(at()).toBe('no controls here'); // a region with nothing to press takes the focus itself
		f6();
		expect(at()).toBe('Spells');
		f6();
		expect(at()).toBe('Roster');
	});

	it('Shift+F6 goes back, and other keys are not its business', () => {
		mountRegions();
		f6();
		f6(true);
		expect(at()).toBe('Spells');
		expect(cycleRegion(new KeyboardEvent('keydown', { code: 'F5' }))).toBe(false);
	});

	it('keeps both directions of F6 inside a visible modal', () => {
		mountRegions();
		const modal = document.createElement('section');
		modal.setAttribute('aria-modal', 'true');
		const control = document.createElement('button');
		control.textContent = 'Close item';
		modal.append(control);
		document.body.append(modal);
		control.focus();
		expect(f6()).toBe(true);
		expect(f6(true)).toBe(true);
		expect(document.activeElement).toBe(control);
		modal.hidden = true;
		expect(f6()).toBe(true);
		expect(at()).toBe('Roster');
	});
});
