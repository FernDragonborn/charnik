/*
 * What a death save is drawn as: wings under a halo for a success, the skull necrotic damage wears
 * for a failure. Paths for the 24-unit box every hand-drawn glyph uses.
 */
import { damageGlyph } from '$lib/components/damage-glyphs';

/** Two feathers a side, drawn to fill the square so the silhouette survives 24px, under a halo
 *  whose opening is still an opening at that size. */
export const WINGS_GLYPH: readonly string[] = [
	'M7.4 4a4.6 2.3 0 1 0 9.2 0a4.6 2.3 0 1 0-9.2 0',
	'M12 12.5C9.4 8.6 5.6 6.9 1.8 7c.2 2.9 1.6 4.9 3.6 6-.4 1.3.3 2.6 1.6 3.3.9 1.6 2.9 2.4 5 4.2',
	'M12 12.5c2.6-3.9 6.4-5.6 10.2-5.5-.2 2.9-1.6 4.9-3.6 6 .4 1.3-.3 2.6-1.6 3.3-.9 1.6-2.9 2.4-5 4.2',
	'M12 12.5v8',
];

/** The skull is necrotic damage's own glyph: one drawing for one idea. */
export const SKULL_GLYPH: readonly string[] = damageGlyph('necrotic');
