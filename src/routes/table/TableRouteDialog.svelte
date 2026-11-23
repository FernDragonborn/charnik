<script lang="ts">
	// The first time a table is opened on this device: how players will reach it, with the public
	// relay already chosen, said once before anything is opened. The choices are Settings ▸ Table's
	// own, so there is one place they are explained and one they are kept.
	import { _ } from '#lib/i18n/index.ts';
	import DialogShell from '#lib/components/DialogShell.svelte';
	import TableSettings from '#lib/components/settings/TableSettings.svelte';

	let { onOpen, onCancel }: { onOpen: () => void; onCancel: () => void } = $props();
</script>

<DialogShell
	titleId="table-route-title"
	title={$_('table.route.title')}
	subtitle={$_('table.route.subtitle')}
	width="min(640px, calc(100vw - 2 * var(--space-4)))"
	onDismiss={onCancel}
>
	<div class="dialog-body">
		<TableSettings embedded />
	</div>
	<footer class="dialog-foot">
		<span class="dialog-spacer"></span>
		<button class="btn ghost" onclick={onCancel}>{$_('app.cancel')}</button>
		<button class="btn primary" onclick={onOpen}>{$_('table.host.open')}</button>
	</footer>
</DialogShell>
