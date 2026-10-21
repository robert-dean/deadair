// The portraits this repository ships, held to the manifest that answers for them. A picture dropped
// into the directory without its line, a line whose checksum no longer matches, or a portrait named for
// a persona nobody seeds would each ship without anybody noticing, so this is the check that notices.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { isArtExtension } from '../../../src/modules/art/art.store.js';
import { SEED_PERSONAS } from '../../../src/modules/personas/persona.defaults.js';

const ROOT = join(import.meta.dirname, '../../../../../assets/art/personas');

interface Entry {
    key: string;
    file: string;
    sha256: string;
    source: string;
    licence: string;
}

const manifest = async (): Promise<Entry[]> => JSON.parse(await readFile(join(ROOT, 'MANIFEST.json'), 'utf8')).personas as Entry[];

const pictures = async (): Promise<string[]> =>
    (await readdir(ROOT)).filter(entry => isArtExtension(entry.slice(entry.lastIndexOf('.') + 1).toLowerCase())).sort();

describe('the shipped persona portraits', () => {
    it('list every picture in the directory, and no picture that is not there', async () => {
        expect((await manifest()).map(entry => entry.file).sort()).toEqual(await pictures());
    });

    it('name each picture for its persona, and only for a persona this repository seeds', async () => {
        const seeded = new Set(SEED_PERSONAS.map(persona => persona.key));

        for (const entry of await manifest()) {
            expect(entry.file.slice(0, entry.file.lastIndexOf('.'))).toBe(entry.key);
            expect(seeded.has(entry.key), `${entry.key} is not a persona persona.defaults.ts seeds`).toBe(true);
        }
    });

    it('carry the checksum of the bytes that actually ship, and the one licence allowed', async () => {
        for (const entry of await manifest()) {
            const bytes = await readFile(join(ROOT, entry.file));

            expect(createHash('sha256').update(bytes).digest('hex'), entry.file).toBe(entry.sha256);
            expect(entry.licence).toBe('CC0-1.0');
            expect(entry.source.length).toBeGreaterThan(0);
        }
    });
});
