import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ContentMetaModal from './ContentMetaModal.svelte';
import { startI18n, locale, waitLocale } from '$lib/i18n';
import { parseContentDirectives, checkFileMeta } from '$lib/content/meta';

// Drive the modal with the SAME missing-meta the loader would derive from an underfilled homebrew CSV.
const UNDERFILLED_CSV =
	'id,name_en,text_en,level,school\ntest_bolt,Test Bolt,A bolt.,1,evocation\n';

function underfilledIssue() {
	const { directives } = parseContentDirectives(UNDERFILLED_CSV);
	return checkFileMeta('spells_homebrew.csv', directives)!;
}

beforeAll(async () => {
	await startI18n('uk');
	locale.set('uk');
	await waitLocale();
});

describe('ContentMetaModal (browser)', () => {
	it('shows the human fields to fill and the auto-fill FYI for the missing keys', async () => {
		const issue = underfilledIssue();
		expect(issue.missingHuman).toEqual(['source', 'license']);
		render(ContentMetaModal, {
			issues: [issue],
			onFillAndSave: () => {},
			onSkip: () => {},
			onNeverAsk: () => {}
		});
		await expect.element(page.getByRole('dialog')).toBeInTheDocument();
		await expect.element(page.getByText('spells_homebrew.csv')).toBeInTheDocument();
		await expect.element(page.getByText('Джерело', { exact: true })).toBeInTheDocument(); // source label
		await expect.element(page.getByText('CC-BY-4.0')).toBeInTheDocument(); // a license card
		await expect.element(page.getByText('CC-BY-SA-4.0')).toBeInTheDocument(); // ordered right after CC-BY
	});

	it('Escape skips (dismiss without filling)', async () => {
		const onSkip = vi.fn();
		render(ContentMetaModal, {
			issues: [underfilledIssue()],
			onFillAndSave: () => {},
			onSkip,
			onNeverAsk: () => {}
		});
		await page
			.getByRole('dialog')
			.element()
			.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(onSkip).toHaveBeenCalled();
	});
});
