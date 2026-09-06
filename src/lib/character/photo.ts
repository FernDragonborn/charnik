/*
 * A character's portrait, from the file the player picked to the bytes that land in their folder.
 *
 * The picker hands over whatever a phone camera produced, so the image is DOWNSCALED at pick time —
 * a 12 MB JPEG dropped into a folder the user is told they own is a worse gift than a resized one,
 * and the sheet never shows it larger than a thumbnail anyway. What is stored is a re-encode, not
 * the original file: the format is whatever the canvas actually produced (`toBlob` falls back to
 * PNG where a codec is missing), read off the blob rather than assumed, so the extension on disk
 * always matches the bytes in it.
 *
 * The bytes themselves are written through `Storage` by `repository.ts`, which owns the layout.
 */

/** Longest edge of a stored portrait. A sheet thumbnail is ~64px; 512 leaves room to zoom without
 *  keeping a photograph. */
export const PHOTO_MAX_EDGE = 512;

/** A picked, downscaled portrait waiting to be written — the bytes plus the extension they earned. */
export interface PickedPhoto {
	bytes: Uint8Array;
	/** File extension WITHOUT the dot, matching `mime`. */
	ext: string;
	mime: string;
}

/** Where a rendered portrait's pixels come from: a file already in a character's folder, or one the
 *  player just picked and has not saved yet (a build has no folder to write into until it is
 *  created). Lives here rather than on the component so a view-model can hold one. */
export type PortraitSource =
	{ kind: 'stored'; id: string; name: string } | { kind: 'picked'; photo: PickedPhoto };

/** The image types a portrait may be stored as, and the extension each gets. A type outside this
 *  map is re-encoded to one that is in it — never written under a guessed extension. */
const PHOTO_TYPES: Record<string, string> = {
	'image/webp': 'webp',
	'image/jpeg': 'jpg',
	'image/png': 'png',
};
/** Asked for first: a portrait is a photograph, and webp is the smallest of the three. Where the
 *  webview cannot encode it, `toBlob` returns PNG and the extension follows the blob. */
const PREFERRED_TYPE = 'image/webp';
const FALLBACK_TYPE = 'image/png';
const QUALITY = 0.85;

/** Fit `(w, h)` inside a `max`-edge square, never scaling UP — a small portrait stays as it is. */
export function fitWithin(
	w: number,
	h: number,
	max: number = PHOTO_MAX_EDGE,
): { width: number; height: number } {
	const scale = Math.min(1, max / Math.max(w, h));
	return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Decode → downscale → re-encode one picked image. Rejects with a plain Error when the file is not
 *  an image the webview can decode, which is the only failure a caller has to say anything about. */
export async function downscalePhoto(file: Blob): Promise<PickedPhoto> {
	const bitmap = await createImageBitmap(file);
	const { width, height } = fitWithin(bitmap.width, bitmap.height);
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('no 2d context');
	ctx.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();
	const blob = await new Promise<Blob | null>((resolve) =>
		canvas.toBlob(resolve, PREFERRED_TYPE, QUALITY),
	);
	const encoded = blob ?? (await blobOf(canvas));
	const mime = PHOTO_TYPES[encoded.type] ? encoded.type : FALLBACK_TYPE;
	return {
		bytes: new Uint8Array(await encoded.arrayBuffer()),
		ext: PHOTO_TYPES[mime] ?? 'png',
		mime,
	};
}

/** Second attempt at an encode, in the format every canvas can produce. */
async function blobOf(canvas: HTMLCanvasElement): Promise<Blob> {
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, FALLBACK_TYPE));
	if (!blob) throw new Error('the image could not be re-encoded');
	return blob;
}

/** The media type a stored portrait's NAME implies — what an object URL needs to render it. */
export function photoMime(name: string): string {
	const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
	return Object.keys(PHOTO_TYPES).find((m) => PHOTO_TYPES[m] === ext) ?? FALLBACK_TYPE;
}
