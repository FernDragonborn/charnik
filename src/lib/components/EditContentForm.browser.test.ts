/*
 * A row saved inside the autosave's debounce stays saved: the pending autosave must not write the
 * draft back after `save()` deleted it, or the Drafts pane offers content that is already a row.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import EditContentFormHost from './EditContentFormHost.test-host.svelte';
import { startI18n } from '#lib/i18n/index.ts';
import { getUserStorage } from '#lib/storage/provider.ts';
import { listDrafts } from '#lib/drafts/store.ts';

// the demo flag reads SvelteKit's env, which the browser project does not serve; content is writable here
vi.mock('#lib/config/demo.ts', () => ({ isDemo: () => false, isReadOnlyContent: () => false }));

beforeAll(() => startI18n('en'));
afterEach(() => vi.useRealTimers());

/** Wait on REAL time: `vi.waitFor` advances faked timers as it polls, which would fire the debounce. */
const realTimeout = globalThis.setTimeout.bind(globalThis);
const realDelay = (ms: number) => new Promise((resolve) => realTimeout(resolve, ms));
async function until(done: () => boolean): Promise<void> {
	for (let tries = 0; !done(); tries++) {
		if (tries > 100) throw new Error('timed out');
		await realDelay(50);
	}
}

describe('EditContentForm', () => {
	it('leaves no draft behind a row saved inside the autosave debounce', async () => {
		let saved = '';
		await render(EditContentFormHost, { onsave: (id: string) => (saved = id) });
		const name = document.querySelector<HTMLInputElement>('.titlein');
		if (!name) throw new Error('the form has no name field');
		// only the debounce is faked: the save's own storage work runs on real time, so however long it
		// takes, the debounce is still pending when it ends
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		name.value = 'Debounce Tongue';
		name.dispatchEvent(new Event('input', { bubbles: true }));
		await Promise.resolve(); // the autosave effect flushes on a microtask and arms its timer
		document.querySelector<HTMLButtonElement>('.save')?.click();
		await until(() => saved !== '' && document.querySelector('.titlein') === null);
		await vi.runAllTimersAsync();
		vi.useRealTimers();
		// a timer that fired starts a storage write it does not await; give it the time to land
		await realDelay(300);
		const drafts = await listDrafts(getUserStorage());
		expect(drafts.filter((d) => d.target.kind === 'add' && d.target.type === 'language')).toEqual(
			[],
		);
	});
});
