/**
 * A character out to a file and back, against the real database.
 *
 * `persona.file.test.ts` and `persona.file.plan.test.ts` cover the mapping and the plan with
 * hand-built rows, which is where the decisions are — but neither proves anything about the two
 * repositories underneath, and this is the only place the three meet. It runs the whole trip: a REAL
 * persona out to a file, back into the station it came from, and out again onto one that has never
 * seen it.
 *
 * The round trip onto the SAME station is the assertion worth having most. Every key resolving to
 * what it came from means nothing was lost on the way out and nothing is duplicated on the way back,
 * and both halves of that are SQL that no unit test reaches.
 *
 * Every one of those is a silent failure. An `id` or an `active` that travelled would restore onto
 * nothing or change who is presenting on somebody else's station, and neither throws; a story whose
 * state was read wrongly would put a model's unverified guess into a stranger's export. The unit
 * tests can only say the mapper agrees with itself.
 *
 * Everything it writes is in a transaction that is thrown away, so it leaves nothing behind on a
 * station that is running. It is safe against the live database, including on air.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/persona.file.smoke.ts
 */

/** The database half of `.env`, read by hand: this script wants a pool, not the app's whole config. */
function env(key: string, fallback: string): string {
    if (process.env[key] !== undefined) return process.env[key];
    const line = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
    return line?.[1]?.trim() ?? fallback;
}

import { readFileSync } from 'node:fs';
import { Kysely } from 'kysely';
import { EmptyUpdateRewriteDialect, KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';
import type { Logger } from '@maroonedsoftware/logger';

import type { DB } from '../src/modules/data/db.js';
import type { PadSetRepository } from '../src/modules/render/pad.set.repository.js';
import type { SpeechService } from '../src/modules/render/speech.service.js';
import { personaForFile, PERSONA_FILE_FORMAT } from '../src/modules/personas/persona.file.js';
import { PersonaImportService } from '../src/modules/personas/persona.import.service.js';
import { PersonaRepository } from '../src/modules/personas/persona.repository.js';
import { PersonaStoriesRepository } from '../src/modules/personas/persona.stories.repository.js';
import type { PersonasService } from '../src/modules/personas/personas.service.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;

const pool = new KyselyPool({
    host: env('DATABASE_HOST', 'localhost'),
    port: Number(env('DATABASE_PORT', '55432')),
    user: env('DATABASE_USER', 'postgres'),
    password: env('DATABASE_PASSWORD', 'postgres'),
    database: env('DATABASE_NAME', 'deadair'),
    // See the note in `rating.smoke.ts`: without these a timestamptz comes back as a string, and
    // `lastToldAt` is one of the fields this script is checking does NOT reach a file.
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new EmptyUpdateRewriteDialect({ pool }, quiet), plugins: [...KyselyDefaultPlugins] });

const say = (line: string) => process.stdout.write(`${line}\n`);
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    say(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
};

/** Thrown to unwind the transaction once the checks inside it are done. */
class Rollback extends Error {}

/** A key nothing else can be using, so a failure here is about this script rather than about the station. */
const KEY = 'smoke-file';

await db
    .transaction()
    .execute(async trx => {
        const station = new StationIdentity();
        const personas = new PersonaRepository(trx, station);
        const stories = new PersonaStoriesRepository(trx, station);

        // Deliberately a character with every optional field set AND put on air, because the two
        // things that must not travel are the id the row was given and the fact that it is
        // presenting. A persona with nothing filled in would pass this by having nothing to lose.
        const written = await personas.create({
            key: KEY,
            kind: 'host',
            label: 'The smoke host',
            style: 'a voice for a script that will be rolled back',
            djName: 'Smoke',
            voice: 'overnight',
            soundboard: 'station',
            background: 'Nothing that ever happened.',
            brevity: 'short',
            latitude: 'loose',
            storytelling: 'often',
            templates: 'That was {{previous.title}}.',
            diction: ['drop the g'],
            dictionMarkers: ['friend'],
            quirks: ['never explains a record'],
            preoccupations: ['the desert'],
            catchphrases: ['stay up'],
            avoid: ['radio voice'],
            samples: ['Stay up, friend.'],
        });
        await personas.setActive(written.id);
        const persona = await personas.find(written.id);
        if (persona === undefined) throw new Error('the persona this script just wrote is not there');

        say('what a file carries about the character');
        check('it is on air, so the mapper has something to drop', persona.active, true);

        // One story of each state, so the sieve is exercised against rows the database actually
        // wrote rather than against three objects a test made up.
        const told = await stories.add({
            personaKey: KEY,
            title: 'The Barstow lights',
            story: 'Three of them.',
            state: 'active',
            origin: 'operator',
        });
        await stories.markTold(told.id);
        await stories.addDetail({ storyId: told.id, detail: 'the third one held still', state: 'active', origin: 'operator' });
        await stories.addDetail({ storyId: told.id, detail: 'a model made this up', state: 'suggested', origin: 'model' });
        await stories.add({ personaKey: KEY, title: 'A proposal', story: 'Nobody has looked at this.', state: 'suggested', origin: 'model' });
        const turnedDown = await stories.add({
            personaKey: KEY,
            title: 'Turned down',
            story: 'The operator said no.',
            state: 'active',
            origin: 'model',
        });
        await stories.setState(turnedDown.id, 'rejected');

        const file = personaForFile(persona, await stories.list(KEY));

        check('the row id does not travel', Object.hasOwn(file, 'id'), false);
        check('nor does who is on air', Object.hasOwn(file, 'active'), false);
        check('the key does, because that is what identifies a character across two installs', file.key, KEY);
        check('and so does what the character is for', file.kind, 'host');
        check('the voice travels, even though the far side may not map it', file.voice, 'overnight');
        check('and so does the board, even though the far side may not hold it', file.soundboard, 'station');
        check('the phrasings travel', file.templates, 'That was {{previous.title}}.');
        check('and every list on the sheet', file.samples, ['Stay up, friend.']);

        say('');
        say('what a file carries about its stories');
        const titles = file.stories.map(story => story.title).sort();
        check('a decided story travels and an undecided one does not', titles, ['The Barstow lights', 'Turned down']);

        const barstow = file.stories.find(story => story.title === 'The Barstow lights');
        check('an active story carries no state, since active is what a story ordinarily is', Object.hasOwn(barstow ?? {}, 'state'), false);
        check(
            'a rejected one is marked, so the far side does not re-propose it',
            file.stories.find(story => story.title === 'Turned down')?.state,
            'rejected',
        );

        // The rotation belongs to the station that told it. `markTold` above is what makes this a
        // real check rather than one against a column that happened to be null.
        check('how often THIS station told it does not travel', Object.hasOwn(barstow ?? {}, 'timesTold'), false);
        check('nor when it last did', Object.hasOwn(barstow ?? {}, 'lastToldAt'), false);
        check('and neither does what suggested it', Object.hasOwn(barstow ?? {}, 'source') || Object.hasOwn(barstow ?? {}, 'origin'), false);

        check('a details sieve runs the same way as the stories one', barstow?.details, [{ detail: 'the third one held still' }]);

        // ------------------------------------------------------------------------------------
        // And back in. The round trip onto the SAME station is the assertion worth having: every
        // key resolving to what it came from means nothing was lost on the way out and nothing is
        // duplicated on the way back, which no unit test can say because both halves are the SQL.
        // ------------------------------------------------------------------------------------

        const importer = new PersonaImportService(
            personas,
            // The answer's shape only. Everything this script checks it does is in the two
            // repositories above; the roster view is `PersonasService`'s and is not under test.
            { list: async () => ({ personas: [] }) } as unknown as PersonasService,
            stories,
            // Nothing can speak and there are no racks, which is the honest state for a script with
            // no container: both only ever add NOTICES, and notices are what `persona.file.plan.test.ts`
            // covers.
            { speaker: () => undefined } as unknown as SpeechService,
            { list: async () => [] } as unknown as PadSetRepository,
            quiet,
        );

        const document = { format: PERSONA_FILE_FORMAT, takenAt: '2026-08-27T00:00:00.000Z', station: 'main', personas: [file] };

        say('');
        say('the same file, back into the station it came from');
        const again = await importer.import(document);
        check('it creates nothing, because this character is already here', again.created, 0);
        check('it rewrites the one sheet', again.updated, 1);
        check('and writes no story, because every one of them is already held', again.storiesWritten, 0);
        check('nor any detail', again.detailsWritten, 0);

        const after = await stories.list(KEY);
        check('so the shelf is exactly as long as it was', after.length, 3);
        check('with the undecided proposal untouched, which no file ever carried', after.filter(story => story.state === 'suggested').length, 1);
        check('and the turned-down one still turned down', after.filter(story => story.state === 'rejected').length, 1);
        check(
            'and the rotation this station spent is still spent, because a file never carried it',
            after.find(story => story.title === 'The Barstow lights')?.timesTold,
            1,
        );

        say('');
        say('the same file onto a station that has never seen it');
        // Which is what a SHARE actually is, and the case the whole feature is for. A second station
        // key gives a genuinely empty shelf without a second database.
        const elsewhere = new StationIdentity();
        (elsewhere as { stationKey: string }).stationKey = 'smoke-elsewhere';
        const theirPersonas = new PersonaRepository(trx, elsewhere);
        const theirStories = new PersonaStoriesRepository(trx, elsewhere);
        const theirImporter = new PersonaImportService(
            theirPersonas,
            { list: async () => ({ personas: [] }) } as unknown as PersonasService,
            theirStories,
            { speaker: () => undefined } as unknown as SpeechService,
            { list: async () => [] } as unknown as PadSetRepository,
            quiet,
        );

        const landed = await theirImporter.import(document);
        check('it creates the character', landed.created, 1);
        check('and rewrites nothing', landed.updated, 0);
        check('and writes both decided stories', landed.storiesWritten, 2);
        check('and the detail that came with one of them', landed.detailsWritten, 1);

        const theirs = (await theirPersonas.list())[0];
        check('the character arrives with its key', theirs?.key, KEY);
        check('its voice', theirs?.voice, 'overnight');
        check('and its phrasings', theirs?.templates, 'That was {{previous.title}}.');
        // The one thing an import must never do. There is no code in the service that could, and
        // this is the assertion that keeps it that way.
        check('and it is NOT on air', theirs?.active, false);

        const theirShelf = await theirStories.list(KEY);
        check('the stories arrive as the receiving operator’s own', [...new Set(theirShelf.map(story => story.origin))], ['operator']);
        check(
            'the turned-down one arrives turned down, so their enrichment pass does not re-propose it',
            theirShelf.find(story => story.title === 'Turned down')?.state,
            'rejected',
        );
        check(
            'and it has been told nowhere, because a rotation does not travel',
            theirShelf.every(story => story.timesTold === 0),
            true,
        );

        say('');
        say('importing twice, which is what a nervous operator does');
        const twice = await theirImporter.import(document);
        check('the second pass creates nothing', twice.created, 0);
        check('and writes no story, because the handles already match', twice.storiesWritten, 0);
        check('and no detail', twice.detailsWritten, 0);
        check('so the shelf did not double', (await theirStories.list(KEY)).length, 2);

        say('');
        say('what a merge leaves alone');
        // The whole of what MERGE means: their own writing survives a file that has never heard of
        // it. A replace would take this, which is why replace is a different verb and is not built.
        await theirStories.add({ personaKey: KEY, title: 'Something they wrote', story: 'Their own.', state: 'active', origin: 'operator' });
        await theirImporter.import(document);
        const kept = await theirStories.list(KEY);
        check('a story the operator here wrote survives a file that does not carry it', kept.length, 3);
        check('and is still theirs', kept.find(story => story.title === 'Something they wrote')?.state, 'active');

        throw new Rollback();
    })
    .catch(error => {
        if (!(error instanceof Rollback)) throw error;
    });

await db.destroy();
say('');
say(process.exitCode === 1 ? 'something above is wrong' : 'a character travels as a character and nothing else does');
