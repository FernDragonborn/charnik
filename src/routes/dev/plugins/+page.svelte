<script lang="ts">
	// DEV-ONLY preview of Settings ▸ Plugins (PLG-2c). The real tab is desktop-gated (plugins are
	// discovered from the dataDir), so this route force-seeds the store with fake discovered
	// plugins in every status — broken / needs-consent / code-changed / disabled / enabled — to
	// exercise the list AND the consent dialog in a plain browser. Open /dev/plugins.
	import PluginsSettings from '$lib/components/settings/PluginsSettings.svelte';
	import { plugins } from '$lib/effects/plugin-store.svelte';
	import { LOCAL_ORIGIN, type DiscoveredPlugin } from '$lib/effects/plugin-host';
	import { titleCase } from '$lib/util/format';

	const fake = (over: Partial<DiscoveredPlugin> & { namespace: string }): DiscoveredPlugin => ({
		origin: LOCAL_ORIGIN,
		ok: true,
		manifest: {
			api: 1,
			namespace: over.namespace,
			name: titleCase(over.namespace),
			version: '1.2.0',
			author: 'Jane Doe',
			url: 'https://example.com/plugin',
			description: 'Level-scaled dice and computed pools for my table’s homebrew.',
		},
		code: 'globalThis.handlers = {};',
		hash: 'a'.repeat(64),
		...over,
	});

	plugins.supported = true;
	plugins.loaded = true;
	plugins.discovered = [
		fake({ namespace: 'my-homebrew' }), // needs consent
		fake({ namespace: 'exploit-dice', hash: 'b'.repeat(64) }), // enabled below
		fake({ namespace: 'old-friend', hash: 'c'.repeat(64) }), // code changed (stale consent)
		fake({ namespace: 'sleepy', hash: 'd'.repeat(64) }), // consented but disabled
		// shipped INSIDE a content pack — the row must say where it came from, and it is still off
		fake({ namespace: 'dark-sun-rules', origin: 'dark-sun', hash: 'e'.repeat(64) }),
		{
			namespace: 'broken-one',
			origin: LOCAL_ORIGIN,
			ok: false,
			problem: 'plugin.json invalid: version — not a semver version',
		},
		// two providers of one namespace: the loser is shown WITH the reason, never hidden
		{
			namespace: 'my-homebrew',
			origin: 'dark-sun',
			ok: false,
			problem:
				'namespace "my-homebrew" is already provided by your own plugins folder — rename one, they cannot both answer the same plugin token',
		},
	];
	plugins.prefs = {
		consent: {
			'exploit-dice': 'b'.repeat(64),
			'old-friend': 'STALE',
			sleepy: 'd'.repeat(64),
		},
		enabled: { 'exploit-dice': true, sleepy: false },
		killSwitch: false,
	};
	// enabled but its main.js failed to evaluate at boot → the load-error surface (PLG-6/D)
	plugins.loadErrors = {
		'exploit-dice': 'main.js failed to load: SyntaxError: unexpected token (line 12)',
	};
</script>

<div class="page">
	<h1>Dev preview · Settings ▸ Plugins</h1>
	<PluginsSettings />
</div>

<style>
	.page {
		max-width: 820px;
		margin: 0 auto;
		padding: var(--space-6);
	}
</style>
