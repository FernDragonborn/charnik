<script lang="ts">
	// DEV-ONLY — every question the table asks, in the real `static/table-question.html`.
	//
	// The shipped window believes words only from Rust, so outside the app its script stops at once.
	// Here each question is that same page in a frame: once it has loaded, the frame is handed a
	// stand-in for Rust and the page's script is run again. The words come from the catalog in the
	// current locale, a fit resizes the frame as Rust resizes the window, and an answer is said under
	// it. The shipped page is not touched, and no inline script is needed, so the app's CSP holds.
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { _ } from '$lib/i18n';

	/** The question window's logical size, `table_link/question.rs`. */
	const WINDOW_WIDTH = 480;
	const WINDOW_HEIGHT_MIN = 200;
	const WINDOW_HEIGHT_MAX = 640;
	const SAMPLE = {
		table: 'Friday table',
		player: 'Lira',
		code: 'K7Q4MX',
		relay: 'relay.example.org',
	};
	const KINDS = [
		{ kind: 'host', route: 'hostRoute.n0' },
		{ kind: 'join', route: 'joinRoute.relay' },
		{ kind: 'approve', route: null },
		{ kind: 'return', route: 'hostRoute.none' },
		{ kind: 'door', route: null },
		{ kind: 'dismiss', route: null },
	] as const;
	type Kind = (typeof KINDS)[number]['kind'];
	type Route = (typeof KINDS)[number]['route'];
	type FitArgs = { height: number };
	type AnswerArgs = { allow: boolean };

	let heights = $state<Partial<Record<Kind, number>>>({});
	let answers = $state<Partial<Record<Kind, string>>>({});
	let opened = $state(0);

	function wordsOf(kind: Kind, route: Route) {
		const key = (part: string) => `table.native.${kind}.${part}`;
		const values = {
			...SAMPLE,
			route: route ? $_(`table.native.${route}`, { values: SAMPLE }) : '',
		};
		return {
			locale: document.documentElement.lang || 'en',
			title: $_(key('title'), { values }),
			ask: $_(key('ask'), { values }),
			fact: $_(key('fact'), { values }),
			code:
				kind === 'approve'
					? { label: $_(key('codeLabel'), { values }), value: $_(key('code'), { values }) }
					: null,
			body: $_(key('body'), { values }),
			allow: $_(key('allow'), { values }),
			deny: $_(key('deny'), { values }),
		};
	}

	/** Rust, as far as this window asks anything of it. */
	function standInFor(kind: Kind, route: Route) {
		return {
			invoke: async (command: string, args: unknown): Promise<unknown> => {
				if (command === 'table_question_words') return wordsOf(kind, route);
				if (command === 'table_question_fit')
					heights[kind] = Math.min(
						WINDOW_HEIGHT_MAX,
						Math.max(WINDOW_HEIGHT_MIN, (args as FitArgs).height),
					);
				if (command === 'table_question_answer')
					answers[kind] = (args as AnswerArgs).allow ? 'yes' : 'no';
				return null;
			},
		};
	}

	function wake(frame: EventTarget, kind: Kind, route: Route): void {
		if (!(frame instanceof HTMLIFrameElement)) return;
		const inside = frame.contentWindow;
		const doc = frame.contentDocument;
		if (!inside || !doc) return;
		Object.assign(inside, { __TAURI_INTERNALS__: standInFor(kind, route) });
		// `?still` holds the window's motion, so a screenshot is the same every time
		if (page.url.searchParams.has('still')) {
			const still = doc.createElement('style');
			still.textContent = '*{transition:none!important}';
			doc.head.append(still);
		}
		const script = doc.createElement('script');
		script.src = `${base}/table-question.js`;
		doc.head.append(script);
	}

	function openAgain(): void {
		answers = {};
		heights = {};
		opened += 1;
	}
</script>

<div class="page">
	<h1>Dev · the table's question window</h1>
	<p class="hint">
		The real window's page, one frame per question, in the current language and the OS theme. The
		focus opens on the refusal; arrows and Tab move it, Enter answers.
		<button class="btn" onclick={openAgain}>Open them all again</button>
	</p>
	{#key opened}
		<div class="frames" data-fitted={Object.keys(heights).length}>
			{#each KINDS as { kind, route } (kind)}
				<figure>
					<figcaption>{kind}{answers[kind] ? ` — answered ${answers[kind]}` : ''}</figcaption>
					<iframe
						title={kind}
						src="{base}/table-question.html"
						onload={(event) => wake(event.currentTarget, kind, route)}
						style:width="{WINDOW_WIDTH}px"
						style:height="{heights[kind] ?? WINDOW_HEIGHT_MIN}px"
					></iframe>
				</figure>
			{/each}
		</div>
	{/key}
</div>

<style>
	.page {
		padding: var(--space-4);
	}
	h1 {
		font-family: var(--font-display);
		font-size: var(--font-size-h4);
		margin: 0 0 var(--space-2);
	}
	.hint {
		color: var(--color-text-muted);
	}
	.frames {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-4);
		margin-top: var(--space-3);
	}
	figure {
		margin: 0;
	}
	figcaption {
		color: var(--color-text-muted);
		font-size: var(--font-size-sm);
		margin-bottom: var(--space-1);
	}
	/* the frame's border sits outside the height the window measured, as the OS window's frame does */
	iframe {
		box-sizing: content-box;
		display: block;
		border: 1px solid var(--color-border);
	}
</style>
