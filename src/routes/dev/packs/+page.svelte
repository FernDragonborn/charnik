<script lang="ts">
	// DEV-ONLY preview of the content-pack update panel (REL-4). The real thing is desktop-gated —
	// updates only exist where there is a data folder to write into — so this route force-seeds the
	// registry and one pending update carrying every case that needs to be VISIBLE before applying:
	// files to write, a hand-edited file being kept, rows that would disappear with the characters
	// that use them, and a pack that also ships plugins. Open /dev/packs.
	import { onMount } from 'svelte';
	import PackUpdatesSettings from '$lib/components/settings/PackUpdatesSettings.svelte';
	import { loadContentStore } from '$lib/content/store.svelte';
	import { page } from '$app/state';
	import {
		bundledPacks,
		missingBundled,
		packConfig,
		SHIPPED_PACK_REPO,
		UPDATE_MODE
	} from '$lib/content/packs.svelte';
	import { updates } from '$lib/content/remote/updates.svelte';
	import { FILE_CHANGE } from '$lib/content/remote/diff';

	const REPO = SHIPPED_PACK_REPO;
	const THIRD_PARTY = 'https://github.com/someone/dark-sun';

	// seed AFTER the layout's content load: it runs `initPackConfig`, which would otherwise adopt the
	// real (empty) config on top of this fixture
	onMount(async () => {
		await loadContentStore();
		seed();
	});

	function seed() {
		// `?missing` = the pack was deleted: the launch prompt (rendered by the LAYOUT, so it shows in a
		// plain browser too) plus the restore row in the panel. Behind a flag because the prompt is
		// deliberately un-dismissable and would sit on top of everything else this page previews.
		missingBundled.packs = page.url.searchParams.has('missing') ? ['srd-2014'] : [];
		// the shipped pair — so the panel hides "rename folder" on them, as it does in the real app
		bundledPacks.packs = ['srd-2014', 'srd-2024'];

		packConfig.updates = UPDATE_MODE.notify;
		packConfig.packs = {
			'srd-2024': { repo: REPO },
			'srd-2014': { repo: REPO, pinned: true },
			'dark-sun': { repo: THIRD_PARTY }
		};
		// FIXED instants, not `Date.now() - 3h`: the panel renders them with `toLocaleString`, so a
		// relative fixture makes every screenshot differ from the last by a minute and the visual
		// baseline can never be clean. A preview page seeded for looking at has to be deterministic.
		packConfig.repos = {
			[REPO]: { lastCheckedAt: '2026-08-11T09:20:00.000Z', etag: 'W/"a"' },
			[THIRD_PARTY]: { lastCheckedAt: '2026-08-10T06:20:00.000Z' }
		};

		updates.supported = true;
		// the GitHub-only limit, as the panel actually reports it
		updates.error = {
			kind: 'i18n',
			key: 'settings.packs.hostUnsupported',
			values: { repo: 'https://my-server.example/packs' }
		};
		// what a pasted URL turns up, including the code disclosure before you commit
		updates.discovered = [
			{
				pack: 'dark-sun',
				repo: THIRD_PARTY,
				remote: { pack: 'dark-sun', files: [] },
				files: 7,
				plugins: ['dark-sun-rules'],
				installed: false,
				localName: 'dark-sun'
			},
			// the COLLISION case: this repo also publishes an `srd-2024`, and the name is already the
			// shipped pack's — so it is offered a folder beside it, with the name editable first
			{
				pack: 'srd-2024',
				repo: THIRD_PARTY,
				remote: { pack: 'srd-2024', files: [] },
				files: 16,
				plugins: [],
				installed: false,
				localName: 'srd-2024-2'
			}
		];
		updates.pending = {
			'srd-2024': {
				pack: 'srd-2024',
				repo: REPO,
				remote: { pack: 'srd-2024', files: [] },
				diff: {
					pack: 'srd-2024',
					changes: [
						{ path: 'srd-2024/spells_srd.csv', kind: FILE_CHANGE.changed },
						{ path: 'srd-2024/feats_srd.csv', kind: FILE_CHANGE.changed },
						{ path: 'srd-2024/backgrounds_srd.csv', kind: FILE_CHANGE.added },
						{ path: 'srd-2024/items_srd.csv', kind: FILE_CHANGE.preserved },
						{ path: 'srd-2024/languages_srd.csv', kind: FILE_CHANGE.removed }
					]
				},
				removedRows: ['language:SRD 5.2.1:draconic', 'language:SRD 5.2.1:goblin'],
				affected: [{ slug: 'karroth', keys: ['language:SRD 5.2.1:draconic'] }],
				affectedDrafts: ['language:SRD 5.2.1:goblin'],
				plugins: [],
				pluginsChanged: [],
				staged: true
			},
			'dark-sun': {
				pack: 'dark-sun',
				repo: THIRD_PARTY,
				remote: { pack: 'dark-sun', files: [] },
				diff: {
					pack: 'dark-sun',
					changes: [{ path: 'dark-sun/classes_srd.csv', kind: FILE_CHANGE.added }]
				},
				removedRows: [],
				affected: [],
				affectedDrafts: [],
				plugins: ['dark-sun-rules'],
				// the sharper warning: this update rewrites the plugin's code, so it stops until re-approved
				pluginsChanged: ['dark-sun-rules'],
				staged: false
			}
		};
	}
</script>

<h1>Dev preview · Settings ▸ Content updates</h1>
<PackUpdatesSettings />

<style>
	h1 {
		font-family: var(--font-display);
		font-size: var(--font-size-h4);
		margin: 0 0 16px;
	}
</style>
