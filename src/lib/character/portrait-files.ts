/*
 * The portrait file beside a character's save. Its own module because the save names it by file
 * name only, so the order of the write, the save and the clean-up is what keeps the two in step.
 */
import type { Storage, FileEntry } from '../storage/types';
import type { PickedPhoto } from './photo';
import { dirOf } from './repository';

/** The portrait's file name inside a character folder — one per character, so picking a new one
 *  REPLACES the old rather than leaving a folder of orphans the user has to recognise. */
const photoNameOf = (ext: string) => `photo.${ext}`;

/** Write a character's portrait and return the name to store in `build.photo`. The one it replaces
 *  goes once the save naming the new one has landed, so the save never names a file that is gone. */
export async function writeCharacterPhoto(
	storage: Storage,
	id: string,
	photo: PickedPhoto,
): Promise<string> {
	await storage.mkdir(dirOf(id));
	const name = photoNameOf(photo.ext);
	await storage.writeBytes(`${dirOf(id)}/${name}`, photo.bytes);
	return name;
}

/** Read a stored portrait's bytes. Throws like any other missing file — a character whose photo was
 *  deleted from the folder renders without one, which is the caller's decision to make. */
export function readCharacterPhoto(
	storage: Storage,
	id: string,
	name: string,
): Promise<Uint8Array> {
	return storage.readBytes(`${dirOf(id)}/${name}`);
}

/** Give a second character its own copy of a portrait, under the same name. A portrait that cannot
 *  be read is left behind: the copy renders without one, as the original would. */
export async function copyCharacterPhoto(
	storage: Storage,
	from: string,
	to: string,
	name: string,
): Promise<void> {
	let bytes: Uint8Array;
	try {
		bytes = await readCharacterPhoto(storage, from, name);
	} catch {
		return;
	}
	await storage.mkdir(dirOf(to));
	await storage.writeBytes(`${dirOf(to)}/${name}`, bytes);
}

/** Remove every portrait file but the one the save names (`kept` null: the way OUT of having one). A
 *  leftover would be invisible and permanent; a folder that cannot be listed has nothing to remove. */
export async function removeCharacterPhotos(
	storage: Storage,
	id: string,
	kept: string | null = null,
): Promise<void> {
	let entries: FileEntry[];
	try {
		entries = await storage.list(dirOf(id));
	} catch {
		return;
	}
	for (const e of entries)
		if (!e.isDir && e.name.startsWith('photo.') && e.name !== kept)
			try {
				await storage.remove(e.path);
			} catch {
				/* best-effort — a portrait we cannot delete is not a reason to fail the save */
			}
}
