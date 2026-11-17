/** A config write in one demo tab makes the others read the file again (audit-oct-27 D13). */
import { describe, expect, it, vi } from 'vitest';
import { announceConfigWrite, onConfigWrittenElsewhere } from './tab-sync';

describe('config writes across tabs', () => {
	it('another tab hears the file it holds, and not a different one', async () => {
		// a second tab is a second channel of the same name; node's BroadcastChannel delivers across them
		const other = new BroadcastChannel('charnik-config');
		const heard = vi.fn();
		other.addEventListener('message', (e: MessageEvent) => heard(e.data));
		const reload = vi.fn();
		const stop = onConfigWrittenElsewhere('charnik.config.json', reload);
		announceConfigWrite('charnik.config.json');
		other.postMessage('other.json');
		other.postMessage('charnik.config.json');
		await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
		expect(heard).toHaveBeenCalledWith('charnik.config.json');
		stop();
		other.close();
	});
});
