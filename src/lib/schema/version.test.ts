import { describe, it, expect } from 'vitest';
import { migrate, type Migration, type Versioned } from './version';

interface Save extends Versioned {
	value: number;
}

describe('migrate', () => {
	it('returns the data unchanged when already at the target version', () => {
		const data: Save = { schemaVersion: 3, value: 1 };
		expect(migrate(data, {}, 3)).toBe(data);
	});

	it('chains registered migrations up to the target, in order', () => {
		const migrations: Record<number, Migration<Save>> = {
			1: (d) => ({ schemaVersion: 2, value: d.value + 10 }),
			2: (d) => ({ schemaVersion: 3, value: d.value + 100 })
		};
		expect(migrate({ schemaVersion: 1, value: 0 }, migrations, 3)).toEqual({
			schemaVersion: 3,
			value: 110
		});
	});

	it('throws when a step in the chain is missing', () => {
		const migrations: Record<number, Migration<Save>> = {
			1: (d) => ({ schemaVersion: 2, value: d.value })
		};
		expect(() => migrate({ schemaVersion: 1, value: 0 }, migrations, 3)).toThrow(
			/no migration from schemaVersion 2/
		);
	});

	it('throws when data is newer than the app supports', () => {
		expect(() => migrate({ schemaVersion: 5, value: 0 }, {}, 3)).toThrow(/newer than supported/);
	});

	it('throws on a missing schemaVersion', () => {
		expect(() => migrate({ value: 0 } as unknown as Save, {}, 1)).toThrow(/missing schemaVersion/);
	});

	it('throws if a migration fails to advance the version (guards an infinite loop)', () => {
		const migrations: Record<number, Migration<Save>> = {
			1: (d) => ({ schemaVersion: 1, value: d.value }) // forgot to bump
		};
		expect(() => migrate({ schemaVersion: 1, value: 0 }, migrations, 2)).toThrow(/did not advance/);
	});
});
