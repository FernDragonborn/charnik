/**
 * A debounced write that belongs to a key — the row and language a draft was typed in. Scheduling
 * under another key does not drop the waiting write with its timer: it runs it at once, so moving
 * on from what was being typed never loses it (audit-oct-27 U8).
 */
export class KeyedDebounce {
	#pending: { key: string; timer: ReturnType<typeof setTimeout>; write: () => void } | null = null;

	constructor(private readonly ms: number) {}

	/** Wait `ms`, then write — replacing a write waiting under the same key. */
	schedule(key: string, write: () => void): void {
		this.settle(key);
		this.#pending = { key, write, timer: setTimeout(() => this.flush(), this.ms) };
	}

	/** Drop a write waiting under `key` (nothing to write any more); run one waiting under another. */
	settle(key: string): void {
		if (this.#pending?.key !== key) this.flush();
		if (this.#pending) clearTimeout(this.#pending.timer);
		this.#pending = null;
	}

	/** Run the waiting write now, if there is one. */
	flush(): void {
		const waiting = this.#pending;
		if (!waiting) return;
		clearTimeout(waiting.timer);
		this.#pending = null;
		waiting.write();
	}
}
