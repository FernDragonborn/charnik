<script lang="ts" module>
	// The app's icon set: Lucide (ISC), one component so a caller writes `<Icon name="x" />` and never
	// touches an import per glyph — and so a name that comes from DATA (a dialog's `badge`, a draft's
	// kind, a translate status) can pick an icon the same way a literal does.
	//
	// Why icons are DRAWN and never typed as a font character (UBUG-19): a glyph is at the mercy of
	// whatever font resolves it. Three failure modes hit for real here — a small filled glyph with no
	// vertical stem rasterises to a blob (`◆` at cue size), a glyph missing from the app's fonts is
	// substituted by the OS (so the same button is a line drawing on one machine and a colour emoji on
	// another), and a substituted glyph brings its own metrics, so it sits off the text baseline.
	//
	// Keep the keys spelled as Lucide spells them: one name per fact, and the icon is then findable at
	// lucide.dev without a translation table. Two glyphs stay hand-drawn and are NOT here — `DiceIcon`
	// (a d20 with a d4, which no icon set has) and `EyeIcon` (its open/closed pair is the toggle).
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ArrowLeftRight from '@lucide/svelte/icons/arrow-left-right';
	import ArrowUp from '@lucide/svelte/icons/arrow-up';
	import Bot from '@lucide/svelte/icons/bot';
	import Bug from '@lucide/svelte/icons/bug';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import Circle from '@lucide/svelte/icons/circle';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import CircleDot from '@lucide/svelte/icons/circle-dot';
	import CircleX from '@lucide/svelte/icons/circle-x';
	import CornerDownLeft from '@lucide/svelte/icons/corner-down-left';
	import Download from '@lucide/svelte/icons/download';
	import Flag from '@lucide/svelte/icons/flag';
	import FlameKindling from '@lucide/svelte/icons/flame-kindling';
	import Folder from '@lucide/svelte/icons/folder';
	import Infinity_ from '@lucide/svelte/icons/infinity';
	import Info from '@lucide/svelte/icons/info';
	import Minus from '@lucide/svelte/icons/minus';
	import Footprints from '@lucide/svelte/icons/footprints';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Moon from '@lucide/svelte/icons/moon';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Recycle from '@lucide/svelte/icons/recycle';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Search from '@lucide/svelte/icons/search';
	import Settings from '@lucide/svelte/icons/settings';
	import Shield from '@lucide/svelte/icons/shield';
	import Skull from '@lucide/svelte/icons/skull';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Star from '@lucide/svelte/icons/star';
	import Sun from '@lucide/svelte/icons/sun';
	import Swords from '@lucide/svelte/icons/swords';
	import Target from '@lucide/svelte/icons/target';
	import Tent from '@lucide/svelte/icons/tent';
	import Timer from '@lucide/svelte/icons/timer';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Upload from '@lucide/svelte/icons/upload';
	import X from '@lucide/svelte/icons/x';
	import Zap from '@lucide/svelte/icons/zap';

	const ICONS = {
		'arrow-left': ArrowLeft,
		'arrow-left-right': ArrowLeftRight,
		'arrow-up': ArrowUp,
		bot: Bot,
		bug: Bug,
		check: Check,
		'chevron-down': ChevronDown,
		'chevron-right': ChevronRight,
		'chevron-up': ChevronUp,
		circle: Circle,
		'circle-dashed': CircleDashed,
		'circle-dot': CircleDot,
		'circle-x': CircleX,
		'corner-down-left': CornerDownLeft,
		download: Download,
		flag: Flag,
		/* a short rest is an hour by the fire, a long one is making camp — the two used to share the
		   moon, which said "rest" for both and told them apart not at all */
		'flame-kindling': FlameKindling,
		folder: Folder,
		infinity: Infinity_,
		info: Info,
		minus: Minus,
		footprints: Footprints,
		'key-round': KeyRound,
		moon: Moon,
		pencil: Pencil,
		plus: Plus,
		recycle: Recycle,
		'rotate-ccw': RotateCcw,
		'rotate-cw': RotateCw,
		search: Search,
		settings: Settings,
		shield: Shield,
		skull: Skull,
		sparkles: Sparkles,
		star: Star,
		sun: Sun,
		swords: Swords,
		target: Target,
		tent: Tent,
		timer: Timer,
		'triangle-alert': TriangleAlert,
		upload: Upload,
		x: X,
		zap: Zap,
	};

	export type IconName = keyof typeof ICONS;
</script>

<script lang="ts">
	let {
		name,
		size = 15,
		fill = 'none',
		label,
	}: {
		name: IconName;
		/** Px, and it is the FONT's size that it should match, not the box's — 15 sits with body text. */
		size?: number;
		/** `currentColor` fills the shape (a pinned ★ against an unpinned ☆); otherwise line art. */
		fill?: string;
		/** Set ONLY when the icon is the whole of a control's meaning — an icon-only button. Next to a
		 *  text label it must stay unset, or a screen reader reads the label twice. Unset → Lucide marks
		 *  the svg `aria-hidden`, which is the right default for decoration. */
		label?: string;
	} = $props();

	const Glyph = $derived(ICONS[name]);
</script>

<Glyph {size} {fill} {...label ? { 'aria-label': label, role: 'img' } : {}} />
