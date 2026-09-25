import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { en } from '../../src/i18n/en/en.catalog';
import { englishPack, LANGUAGE_PACK_FORMAT, languagePackFilename, languagePackText } from '../../src/i18n/language.pack';
import packageJson from '../../package.json';

describe('englishPack', () => {
    it('is the English catalog under a header a translator changes', () => {
        const pack = englishPack('1.2.3');
        expect(pack).toMatchObject({ format: LANGUAGE_PACK_FORMAT, version: 1, locale: 'en', name: 'English', direction: 'ltr', madeFor: '1.2.3' });
        expect(pack.catalog).toBe(en);
    });

    it('is saved under its language', () => {
        expect(languagePackFilename({ locale: 'pt-BR' })).toBe('deadair-console-pt-BR.json');
    });

    it('reads back as the same document', () => {
        const text = languagePackText(englishPack('1.2.3'));
        expect(text.endsWith('}\n')).toBe(true);
        expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(englishPack('1.2.3'))));
    });
});

// The release job runs this with plain `node` and no install. An extensionless import added to the
// English catalog, or anything the pack module pulls in, breaks it there and nowhere else, so it is
// run here the same way.
describe('scripts/language.template.ts', () => {
    it('writes the English pack with plain node, stamped with the console version', () => {
        const file = join(mkdtempSync(join(tmpdir(), 'language-template-')), 'en.json');
        execFileSync(process.execPath, [resolve(import.meta.dirname, '../../scripts/language.template.ts'), file], { stdio: 'pipe' });
        expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(JSON.parse(languagePackText(englishPack(packageJson.version))));
    });
});
