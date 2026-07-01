<script lang="ts">
	import Wip from '$lib/components/Wip.svelte';
	import { _ } from '$lib/i18n';
</script>

<Wip
	title={$_('nav.settings')}
	note="Content sources, collisions, rule options, theme, system, and language."
/>
