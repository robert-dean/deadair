import { readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';

import { englishPack, languagePackFilename, languagePackText } from '../src/i18n/language.pack.ts';

/**
 * Writes the console's English as a language pack, which is the file a translation starts from.
 *
 * Run by the release job to attach it to each GitHub release, so a translator can begin without
 * running a station, and by hand with `pnpm --filter @deadair/web language:template [file]`. Plain
 * `node`, with no install: see `src/i18n/language.pack.ts` for why that holds.
 */
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const pack = englishPack(version);
const file = argv[2] ?? languagePackFilename(pack);

writeFileSync(file, languagePackText(pack));
console.log(`${file}: the console's English at ${version}`);
