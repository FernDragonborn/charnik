<script lang="ts">
	// A character's face, wherever a character is shown. Both sources end up as one object URL, made
	// here and revoked here — a portrait that outlives its component is a leak nobody sees, and two
	// call sites each minting their own URL is the same bug written twice.
	import Icon from './Icon.svelte';
	import { photoMime, type PortraitSource } from '$lib/character/photo';
	import { readCharacterPhoto } from '$lib/character/repository';
	import { getUserStorage } from '$lib/storage/provider';

	let {
		source,
		size = 64,
		alt = '',
	}: {
		/** Null renders the empty placeholder — a portrait is optional everywhere it appears. */
		source: PortraitSource | null;
		/** Rendered edge, in px. The stored image is capped at PHOTO_MAX_EDGE, so this only ever
		 *  scales DOWN. */
		size?: number;
		alt?: string;
	} = $props();

	let url = $state<string | null>(null);

	async function urlFor(src: PortraitSource): Promise<string | null> {
		// copied into a fresh view: a Blob part must own an ArrayBuffer, and the bytes may arrive over
		// a Storage impl that hands back a view onto something else
		if (src.kind === 'picked')
			return URL.createObjectURL(
				new Blob([new Uint8Array(src.photo.bytes)], { type: src.photo.mime }),
			);
		try {
			const bytes = await readCharacterPhoto(getUserStorage(), src.id, src.name);
			return URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: photoMime(src.name) }));
		} catch {
			// the file the save NAMES is gone (deleted from the folder by hand) — render the
			// placeholder, which is what a character without a portrait looks like anyway
			return null;
		}
	}

	$effect(() => {
		const src = source;
		if (!src) {
			url = null;
			return;
		}
		let live = true;
		let made: string | null = null;
		void urlFor(src).then((u) => {
			if (!live) {
				if (u) URL.revokeObjectURL(u);
				return;
			}
			made = u;
			url = u;
		});
		return () => {
			live = false;
			if (made) URL.revokeObjectURL(made);
		};
	});
</script>

{#if url}
	<img class="portrait" src={url} {alt} style:--portrait-size="{size}px" />
{:else}
	<span class="portrait is-empty" style:--portrait-size="{size}px" aria-hidden="true">
		<Icon name="user-round" size={Math.round(size * 0.5)} />
	</span>
{/if}

<style>
	.portrait {
		inline-size: var(--portrait-size);
		block-size: var(--portrait-size);
		border-radius: var(--radius-md);
		border: 1px solid var(--color-border-strong);
		object-fit: cover;
		background: var(--color-surface-2);
	}
	.is-empty {
		display: grid;
		place-items: center;
		color: var(--color-text-muted);
		border-style: dashed;
	}
</style>
