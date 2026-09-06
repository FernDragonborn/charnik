import { describe, it, expect } from 'vitest';
import { downscalePhoto, fitWithin, photoMime, PHOTO_MAX_EDGE } from './photo';

/*
 * The portrait pipeline in a REAL browser, because every interesting step of it is a webview API:
 * decoding whatever the picker handed over, drawing it smaller, and re-encoding. A jsdom test here
 * would assert a mock. What it must get right is that a huge picture comes back small, and that the
 * extension it claims matches the bytes it produced.
 */

/** A solid-colour PNG of the given size, made the same way a canvas would make one. */
async function pngBlob(width: number, height: number): Promise<Blob> {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('no 2d context');
	ctx.fillStyle = '#8b0000';
	ctx.fillRect(0, 0, width, height);
	const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
	if (!blob) throw new Error('could not build the fixture');
	return blob;
}

describe('fitWithin', () => {
	it('caps the longest edge and keeps the aspect ratio', () => {
		expect(fitWithin(2000, 1000, 512)).toEqual({ width: 512, height: 256 });
		expect(fitWithin(1000, 2000, 512)).toEqual({ width: 256, height: 512 });
	});
	it('never scales a small picture UP — a 64px avatar stays 64px', () => {
		expect(fitWithin(64, 48, 512)).toEqual({ width: 64, height: 48 });
	});
});

describe('downscalePhoto', () => {
	it('re-encodes a large picture down to the stored cap', async () => {
		const photo = await downscalePhoto(await pngBlob(1600, 900));
		const bitmap = await createImageBitmap(new Blob([new Uint8Array(photo.bytes)]));
		expect(Math.max(bitmap.width, bitmap.height)).toBe(PHOTO_MAX_EDGE);
		expect(bitmap.height).toBe(288); // 900 × (512/1600), the ratio kept
		bitmap.close();
	});

	it('reports the format it actually produced, so the extension matches the bytes', async () => {
		const photo = await downscalePhoto(await pngBlob(100, 100));
		expect(photoMime(`photo.${photo.ext}`)).toBe(photo.mime);
	});

	it('rejects a file that is not a decodable image, rather than storing something unopenable', async () => {
		await expect(
			downscalePhoto(new Blob(['not an image'], { type: 'text/plain' })),
		).rejects.toThrow();
	});
});
