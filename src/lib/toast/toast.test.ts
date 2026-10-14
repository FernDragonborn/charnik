import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sonner = vi.hoisted(() => {
	const shown: {
		kind: string;
		title?: string;
		props?: unknown;
		options: Record<string, unknown>;
	}[] = [];
	const plain = (title: string, options: Record<string, unknown>) =>
		shown.push({ kind: 'plain', title, options });
	return {
		shown,
		dismissed: [] as unknown[],
		toast: Object.assign(plain, {
			success: (title: string, options: Record<string, unknown>) =>
				shown.push({ kind: 'success', title, options }),
			warning: (title: string, options: Record<string, unknown>) =>
				shown.push({ kind: 'warning', title, options }),
			error: (title: string, options: Record<string, unknown>) =>
				shown.push({ kind: 'error', title, options }),
			custom: (
				_component: unknown,
				options: { componentProps: unknown } & Record<string, unknown>,
			) => shown.push({ kind: 'card', props: options.componentProps, options }),
		}),
	};
});
vi.mock('svelte-sonner', () => ({
	toast: Object.assign(sonner.toast, { dismiss: (id: unknown) => sonner.dismissed.push(id) }),
}));
vi.mock('$lib/components/RollToast.svelte', () => ({ default: {} }));

import { toast, toastRollCard } from './toast';
import type { RollToastModel } from '$lib/dice/roll-toast';

const roll = { label: 'Hex damage', total: 1, attacks: [] } as unknown as RollToastModel;

beforeEach(() => {
	vi.useFakeTimers();
	sonner.shown.length = 0;
	sonner.dismissed.length = 0;
});
afterEach(() => {
	vi.runAllTimers();
	// close whatever the test left standing, so the next one starts with nothing on screen
	for (const s of sonner.shown) (s.options.onDismiss as (() => void) | undefined)?.();
	vi.useRealTimers();
});

describe('one action, one toast', () => {
	it('a roll and the notice the same action left are ONE card', () => {
		toastRollCard(roll);
		toast.warning('Hex cast, but you can’t hold Concentration right now', {
			description: 'A Rage ends Concentration.',
		});
		expect(sonner.shown).toHaveLength(0); // nothing until the action is over
		vi.runAllTimers();
		expect(sonner.shown).toHaveLength(1);
		expect(sonner.shown[0]).toMatchObject({
			kind: 'card',
			props: {
				models: [roll],
				notes: [
					{
						tone: 'warning',
						title: 'Hex cast, but you can’t hold Concentration right now',
						description: 'A Rage ends Concentration.',
					},
				],
			},
		});
	});

	it('a lone notice keeps the toaster’s own card and tone', () => {
		toast.success('Saved');
		vi.runAllTimers();
		expect(sonner.shown).toEqual([expect.objectContaining({ kind: 'success', title: 'Saved' })]);
	});

	it('the next action replaces the card on screen rather than stacking under it', () => {
		toast('first');
		vi.runAllTimers();
		const firstId = sonner.shown[0]?.options.id;
		toast('second');
		vi.runAllTimers();
		expect(sonner.dismissed).toEqual([firstId]);
		expect(sonner.shown.at(-1)).toMatchObject({ title: 'second' });
	});

	it('a standing notice rides the next card instead of being replaced away', () => {
		toast.warning('Translations were left behind', { duration: Infinity });
		vi.runAllTimers();
		toastRollCard(roll);
		vi.runAllTimers();
		expect(sonner.shown.at(-1)).toMatchObject({
			kind: 'card',
			props: { models: [roll], notes: [{ title: 'Translations were left behind' }] },
			options: { duration: Infinity },
		});
	});

	it('once dismissed, a standing notice is gone for good', () => {
		toast.warning('Translations were left behind', { duration: Infinity });
		vi.runAllTimers();
		(sonner.shown[0]?.options.onDismiss as () => void)();
		toast('later');
		vi.runAllTimers();
		expect(sonner.shown.at(-1)).toMatchObject({ kind: 'plain', title: 'later' });
	});

	it('a keyed notice said twice is said once', () => {
		toast('Could not save', { id: 'save-failed' });
		toast('Could not save', { id: 'save-failed' });
		vi.runAllTimers();
		expect(sonner.shown).toEqual([
			expect.objectContaining({ kind: 'plain', title: 'Could not save' }),
		]);
	});
});
