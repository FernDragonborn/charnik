<script lang="ts">
	// DEV-ONLY preview of the content-pack update panel (REL-4). The real thing is desktop-gated —
	// updates only exist where there is a data folder to write into — so this route force-seeds the
	// registry and one pending update carrying every case that needs to be VISIBLE before applying:
	// files to write, a hand-edited file being kept, rows that would disappear with the characters
	// that use them, and a pack that also ships plugins. Open /dev/packs.
	import { onMount } from 'svelte';
	import PackUpdatesSettings from '$lib/components/settings/PackUpdatesSettings.svelte';
	import { loadContentStore } from '$lib/content/store.svelte';
	import { packConfig, UPDATE_MODE } from '$lib/content/packs.svelte';
	import { updates } from '$lib/content/remote/updates.svelte';
	import { FILE_CHANGE } from '$lib/content/remote/diff';

	const REPO = 'https://github.com/FernDragonborn/charnik-content-srd';
	const THIRD_PARTY = 'https://github.com/someone/dark-sun';

	// seed AFTER the layout's content load: it runs `initPackConfig`, which would otherwise adopt the
	// real (empty) config on top of this fixture
	onMount(async () => {
		await loadContentStore();
		seed();
	});

	function seed() {
		packConfig.updates = UPDATE_MODE.notify;
		packConfig.packs = {
			'srd-2024': { repo: REPO },
			'srd-2014': { repo: REPO, pinned: true },
			'dark-sun': { repo: THIRD_PARTY }
		};
		packConfig.repos = {
			[REPO]: { lastCheckedAt: new Date(Date.now() - 3 * 3600_000).toISOString(), etag: 'W/"a"' },
			[THIRD_PARTY]: { lastCheckedAt: new Date(Date.now() - 26 * 3600_000).toISOString() }
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
				installed: false
			},
			{
				pack: 'srd-2024',
				repo: THIRD_PARTY,
				remote: { pack: 'srd-2024', files: [] },
				files: 16,
				plugins: [],
				installed: true
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
				plugins: [],
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
				plugins: ['dark-sun-rules'],
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
