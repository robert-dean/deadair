/**
 * The soundboard, end to end against the real database and a real mixer.
 *
 * Two halves the unit tests cannot reach, and each is the whole of something.
 *
 * The SQL. `breaksSincePad` is a correlated subquery against a jsonb column and is what the
 * deterministic floor's spacing is judged on; the partial unique index is what makes a board's names
 * unique per board and lets a rejected pad be replaced under its own name; and `onBoard`'s
 * `nulls first` is the rotation. All four are SQL, so nothing in `apps/api/tests` runs any of them,
 * and three fail SILENTLY when they are wrong — a spacing rule that never matches is a station that
 * never makes a noise, which looks exactly like a station with an empty rack.
 *
 * The JOIN. Everything downstream of `MixerService.join` is a plugin talking to a sidecar over HTTP,
 * so the unit tests fake it whole. What is actually unproven until something does it for real is
 * that the URLs the render path builds are FETCHABLE FROM THE SIDECAR, which is a different
 * container with a different idea of what `localhost` means — and a join that cannot fetch its parts
 * degrades silently to a break that airs as words.
 *
 * The database half builds its own fixture inside a transaction and rolls it back, so it touches
 * nothing the station owns. The join half needs a running API and analyzer and says so rather than
 * failing when they are absent: a machine with no sidecar should not report a broken soundboard.
 *
 * Run from `apps/api` with:
 *   node --import @swc-node/register/esm-register ./scripts/pads.smoke.ts
 */

/** The database half of `.env`, read by hand: this script wants a pool, not the app's whole config. */
function env(key: string, fallback: string): string {
    if (process.env[key] !== undefined) return process.env[key];
    const line = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(new URL('../.env', import.meta.url), 'utf8'));
    return line?.[1]?.trim() ?? fallback;
}

import { readFileSync } from 'node:fs';
import { Kysely, sql } from 'kysely';
import { EmptyUpdateRewriteDialect, KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { PadRepository } from '../src/modules/render/pad.repository.js';
import { PadSetRepository } from '../src/modules/render/pad.set.repository.js';
import { SegmentRepository } from '../src/modules/render/segment.repository.js';
import { padsIn, splitOnPads } from '../src/modules/render/pad.cues.js';
import { resolvePlayoutBaseUrl, storedAudioUrl } from '../src/modules/playout/playout.urls.js';

/**
 * A pool over the station's own database.
 *
 * A function because this script needs two: the first is destroyed with the transaction it rolls
 * back, and the join half runs afterwards. See the note in `rating.smoke.ts` for why the type
 * overrides matter — without them the script reads different types from the same rows than the app
 * does, which is how a repro invents a failure the app does not have.
 */
const newPool = () =>
    new KyselyPool({
        host: env('DATABASE_HOST', 'localhost'),
        port: Number(env('DATABASE_PORT', '55432')),
        user: env('DATABASE_USER', 'postgres'),
        password: env('DATABASE_PASSWORD', 'postgres'),
        database: env('DATABASE_NAME', 'deadair'),
        types: KyselyPgTypeOverrides,
    });

const pool = newPool();
const quiet = { info() {}, warn() {}, error() {}, debug() {} } as never;
// `KyselyDefaultPlugins` is what maps `stationKey` to `station_key`. Without it every repository
// here queries a column that does not exist, which is a failure of the SCRIPT rather than of the
// code it is meant to be checking.
const db = new Kysely<DB>({ dialect: new EmptyUpdateRewriteDialect({ pool }, quiet), plugins: [...KyselyDefaultPlugins] });

const say = (line: string) => process.stdout.write(`${line}\n`);
const check = (label: string, actual: unknown, expected: unknown) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    say(`${ok ? '  ok  ' : ' FAIL '} ${label}${ok ? '' : ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`);
    if (!ok) process.exitCode = 1;
};

/** A transaction thrown away on purpose, so a live rack is never touched. */
class Rollback extends Error {}

/**
 * How far back the fixture's first break is stamped.
 *
 * Comfortably older than anything a running station will write during the seconds this takes, so the
 * fixture's own ordering is the only thing under test.
 */
const OLDEST_MINUTES = 60;

/** A board nothing else will have, so the fixture is findable among a real station's rows. */
const BOARD = 'zzsmoke-board';

const identity = { stationKey: 'main' } as never;

try {
    await db.transaction().execute(async trx => {
        const pads = new PadRepository(trx as never, identity);
        const sets = new PadSetRepository(trx as never, identity);
        const segments = new SegmentRepository(trx as never, identity);

        // ── the rack, and what a name means on it ─────────────────────────────
        say('the rack');

        // Imported AND put on the set of the same name, which is what `PadLibrary` does on every
        // scan. The library and the set are two different things now, so a fixture that only did the
        // first would have a rack nothing can reach — which is exactly the failure this script is for.
        const set = await sets.ensure({ key: BOARD, label: BOARD });
        const put = async (name: string, checksum: string) => {
            const imported = await pads.importFile({
                board: BOARD,
                name,
                label: name,
                sourcePath: `${BOARD}/${name}.wav`,
                audioChecksum: checksum,
                audioExt: 'wav',
            });
            await sets.add(set.id, imported.pad.id);
            return imported;
        };

        const first = await put('airhorn', 'sum-one');
        check('a new sound is created', first.outcome, 'created');
        check('the same file again changes nothing', (await put('airhorn', 'sum-one')).outcome, 'unchanged');

        // The whole difference from a segment, which dedups on bytes: a board has a SLOT and the
        // file under it is replaceable, so every script that ever wrote this name now plays the new
        // sound without being touched.
        const swapped = await put('airhorn', 'sum-two');
        check('a different file under the same name REPLACES the slot', swapped.outcome, 'replaced');
        check('and the slot is still one row', (await pads.list(BOARD)).length, 1);
        check('with the new bytes', swapped.pad.audioChecksum, 'sum-two');
        // The measurements described the file that used to be here. Levelling a new sound against
        // the old one is the failure that column exists to prevent.
        check('and no measurement carried over from the old file', swapped.pad.loudnessLufs, undefined);

        // Matched the way the index is, because a model handed a list of names does not reliably
        // give one back in the case it was offered in.
        check('a name is found however it was capitalised', (await pads.named(BOARD, 'AirHorn'))?.id, first.pad.id);

        // ── rejection is a state, which is what makes it survive a re-scan ────
        say('turning one down');

        await pads.setState(first.pad.id, 'rejected');
        check('a rejected pad is unreachable by name', await pads.named(BOARD, 'airhorn'), undefined);
        check('and off the board', (await pads.onSet(BOARD)).length, 0);
        // The partial index: turning down one air horn must not stop the operator putting a better
        // one under the same name.
        check('but the name is free again', (await put('airhorn', 'sum-three')).outcome, 'created');

        // ── the rotation, which is ordered in SQL and nowhere else ────────────
        say('the rotation');

        await put('rimshot', 'sum-four');
        const fresh = await pads.onSet(BOARD);
        check('two sounds are reachable', fresh.length, 2);

        await pads.markUsed(fresh[0]!.id);
        const after = await pads.onSet(BOARD);
        // `nulls first`: a pad nobody has hit sorts in front of one that has, so a board's newest
        // sound does not wait out a full rotation before it is ever heard.
        check('the one nobody has hit comes first', after[0]!.id, fresh[1]!.id);
        check('and the one just spent goes last', after[1]!.id, fresh[0]!.id);

        // ── sets, which are the whole reason a board stopped being the boundary ──
        say('the sets');

        // One library, cut two ways. This is what a `board` column could never express: the same
        // air horn in front of two characters without two copies of the file or two rows.
        const second = await sets.ensure({ key: `${BOARD}-two`, label: 'second' });
        const shared = (await pads.onSet(BOARD))[0]!;
        check('a pad can go on a second set', await sets.add(second.id, shared.id), 'added');
        check('and is reachable from both', (await pads.named(`${BOARD}-two`, shared.name))?.id, shared.id);
        check('adding it twice is not an error', await sets.add(second.id, shared.id), 'already');

        // The rule no index can express, because it spans a join: a script writes a NAME, so a set
        // answering to one name twice is a break that sounds different between two renders.
        const rival = await pads.importFile({
            board: `${BOARD}-elsewhere`,
            name: shared.name,
            label: shared.name,
            sourcePath: 'elsewhere.wav',
            audioChecksum: 'sum-rival',
            audioExt: 'wav',
        });
        check('a second pad under one name is refused BY THE SET', await sets.add(second.id, rival.pad.id), 'name-taken');
        // And is not a collision in the LIBRARY, which is the half that makes two characters with
        // two different air horns possible at all.
        // Scoped to the fixture's own boards, for `advisory.smoke.ts`' reason: this runs against a
        // real station, `list()` with no board is the whole library, and a real rack holding a pad of
        // the same name would otherwise be counted as one of ours.
        const named = (await pads.list()).filter(pad => pad.board.startsWith(BOARD) && pad.name === shared.name && pad.state === 'active');
        check('while the library holds both, reachable from different sets', named.length, 2);

        // Deleting a set takes the grouping and leaves the audio, which is the whole difference
        // between a set and a directory.
        const held = (await pads.list(BOARD)).length;
        check('deleting a set removes it', await sets.remove(second.id), true);
        check('and leaves every pad in the library', (await pads.list(BOARD)).length, held);
        check('and leaves the original set alone', (await pads.onSet(BOARD)).length > 0, true);

        // A key naming nothing is the same answer as a set holding nothing, deliberately: both are a
        // presenter with nothing to reach for and nothing downstream should tell them apart.
        check('a set that does not exist reads as an empty rack', await pads.onSet('zzsmoke-no-such-set'), []);
        check('and naming a pad on it finds nothing', await pads.named('zzsmoke-no-such-set', shared.name), undefined);

        // What a rename or a delete has to warn about, since `personas.soundboard` is a key and the
        // schema would say nothing.
        check('a set can say which personas name it', Array.isArray(await sets.personasNaming(BOARD)), true);

        // ── the spacing the floor is judged on ────────────────────────────────
        say('the spacing');

        // A correlated subquery against a jsonb column, which is the whole of the floor's rule and
        // has no symptom when it is wrong: a count that never reaches the ceiling is a station that
        // never makes a noise, which looks exactly like a rack nobody filled.
        const before = await segments.breaksSincePad();

        /**
         * One break the station actually wrote.
         *
         * Through `plan` → `claimForWrite` → `writeScript`, which is the real path and is NOT
         * optional here: `plan` with a script starts the row at `written`, and `claimForWrite` only
         * takes a `planned` one — so a fixture that shortcut either step wrote nothing at all and
         * every assertion under it passed against a break that had never been touched.
         */
        let minute = 0;
        const wrote = async (label: string, script: string, pads: { name: string; padId: string }[] = []) => {
            const row = await segments.plan({ kind: 'zzsmoke-break', label });
            await segments.claimForWrite(row.id);
            const ok = await segments.writeScript(row.id, { script, label, writer: 'deterministic', pads });
            if (!ok) throw new Error(`the fixture could not write ${label}`);

            // Stamped apart by hand, and this is not fixture convenience.
            //
            // `created_at` defaults to `now()`, which inside a transaction is the TRANSACTION's
            // timestamp — so every row this script plants would otherwise carry the same instant and
            // `breaksSincePad`'s strict `>` would count none of them. In production each break is
            // planted in its own request or job, so the times genuinely differ; here they have to be
            // made to.
            //
            // Worth knowing beyond this script: two breaks planted in ONE transaction really do tie,
            // and the one that hit a pad hides its siblings from the count. The cost is the floor
            // waiting one break longer than it meant to, which is self-correcting and is why this is
            // recorded rather than fixed.
            minute += 1;
            await trx
                .updateTable('deadair.segments')
                // Both, because `segments_check` is `updated_at >= created_at` and moving one alone
                // trips it. Backwards in time rather than forwards, so the rows stay in the past
                // relative to anything the running station writes while this is going on.
                .set({
                    createdAt: sql`now() - ((${OLDEST_MINUTES - minute}) || ' minutes')::interval`,
                    updatedAt: sql`now() - ((${OLDEST_MINUTES - minute}) || ' minutes')::interval`,
                })
                .where('id', '=', row.id)
                .execute();

            return row.id;
        };

        await wrote('zzsmoke plain', 'words');
        check('a break with no hit counts against the spacing', await segments.breaksSincePad(), before + 1);

        const hit = await wrote('zzsmoke hit', 'words [sfx:rimshot]', [{ name: 'rimshot', padId: fresh[1]!.id }]);
        // Everything before it is behind the hit now, so the count starts again. Zero rather than
        // one, because the row that hit the pad IS the watermark and is not after itself.
        check('a break that HIT one resets it', await segments.breaksSincePad(), 0);

        await wrote('zzsmoke after', 'more words');
        check('and the next break counts from there', await segments.breaksSincePad(), 1);

        // A rewrite clears the hit, for `claimsItemId`'s reason: it described THOSE words. Reopened
        // first, because `planned` is the only state a claim takes — and `reopenSegments` is what a
        // recast actually calls, so this is the real path rather than a state moved by hand.
        // (`releaseForRetry` is the wrong door: it hands a RENDER's claim back and leaves the row at
        // `written`, which no writer will claim.)
        await segments.reopenSegments([hit]);
        await segments.claimForWrite(hit);
        await segments.writeScript(hit, { script: 'different words', label: 'zzsmoke hit', writer: 'deterministic' });
        check('rewriting the break takes its hit back off the row', (await segments.findById(hit))?.pads, []);
        // Nothing on the station has hit a pad now, so the count is everything ever written.
        check('so the spacing counts past it again', (await segments.breaksSincePad()) > 1, true);

        // ── the claim, which is the one read that does not use SEGMENT_COLUMNS ──
        say('the claim');

        // `claimForRender` is hand-written SQL against a self-join, so a column added anywhere else
        // never arrives in it. `pads` shipped missing from that list and NOTHING caught it: an
        // absent value reads as an empty array, which is exactly what an ordinary break looks like,
        // so every padded break rendered as plain words, with no error anywhere and every unit test
        // passing — they build a Segment by hand and never come through this statement.
        //
        // This is the assertion that would have caught it. It lives here rather than in
        // `apps/api/tests` because what is under test is a `returning` clause.
        //
        // Its own break, because claiming moves a row to `rendering` and the checks above want one
        // they can still reopen.
        const toRender = await wrote('zzsmoke claimed', 'words [sfx:rimshot]', [{ name: 'rimshot', padId: fresh[1]!.id }]);
        const claimed = await segments.claimForRender(toRender);
        check('a claim for rendering carries the hits with it', claimed?.pads, [{ name: 'rimshot', padId: fresh[1]!.id }]);
        throw new Rollback();
    });
} catch (error) {
    if (!(error instanceof Rollback)) throw error;
} finally {
    await db.destroy();
}

// ── the join, against whatever is actually running ────────────────────────────
//
// Skipped rather than failed where nothing is up: a machine with no sidecar should not report a
// broken soundboard, and this half is about reachability rather than about the code.
say('the join');

// The APP's own resolver rather than a second reading of the same variable. The first version of
// this script hardcoded `localhost` as the fallback and reported the sidecar refusing the station's
// own URL — which is a true sentence about a URL the station never builds: the real default is
// `host.docker.internal`, because the thing fetching is in another container. Two functions that
// each decide what the base URL is are two functions that can disagree, and the one that is wrong
// is always the one not on the air path.
const apiBase = resolvePlayoutBaseUrl({ get: (key: string, fallback: string) => env(key, fallback) } as never);
const analyzerBase = process.env.ANALYZER_URL ?? 'http://localhost:9321';

const alive = async (url: string): Promise<boolean> => {
    try {
        return (await fetch(url, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
        return false;
    }
};

if (!(await alive(`${analyzerBase}/health`))) {
    say('  skip  the analyzer is not running, so nothing can join or measure');
} else {
    // A real blob the station already holds, so this proves the ROUTE rather than a fixture.
    // A second connection, because the one above was destroyed with its transaction.
    const held = await new Kysely<DB>({
        dialect: new EmptyUpdateRewriteDialect({ pool: newPool() }, quiet),
        plugins: [...KyselyDefaultPlugins],
    })
        .selectFrom('deadair.segments')
        .select(['audioChecksum', 'audioExt'])
        .where('audioChecksum', 'is not', null)
        .limit(1)
        .executeTakeFirst();

    if (held?.audioChecksum == null || held.audioExt == null) {
        say('  skip  the station holds no audio to join');
    } else {
        const url = storedAudioUrl(apiBase, held.audioChecksum, held.audioExt);

        // Deliberately NOT fetched from this process first. The URL names the station as the
        // SIDECAR has to see it (`host.docker.internal` by default), which on a developer's own
        // machine frequently does not resolve at all — so a check here would report a failure about
        // a URL that is completely correct for the only thing that fetches it.
        //
        // What follows is the assertion the whole script exists for: a container with a different
        // idea of `localhost` is exactly how a join degrades to a break that airs as words, with one
        // log line and no other symptom.
        const joined = await fetch(`${analyzerBase}/join`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ parts: [{ url }, { url }], gapMs: 60 }),
            signal: AbortSignal.timeout(120_000),
        }).catch(() => undefined);

        if (joined === undefined) {
            check('the mixer answered', false, true);
        } else if (!joined.ok) {
            say(` FAIL  the mixer refused the station's own URL — ${await joined.text()}`);
            say('        this is the failure that matters: the sidecar cannot fetch what the render path builds');
            process.exitCode = 1;
        } else {
            check('the mixer joined two parts it fetched from the station', joined.headers.get('content-type'), 'audio/flac');
            const length = Number(joined.headers.get('x-duration-ms') ?? '0');
            check('and answered with audio longer than nothing', length > 0, true);
            say(`        joined ${(await joined.arrayBuffer()).byteLength} bytes, ${length}ms`);
        }
    }
}

// ── the cue arithmetic, which is pure and is here for the round trip ──────────
say('the cue');

const script = 'Ambitious. [sfx:rimshot] They played it anyway.';
check('a hit is found where the sentence put it', padsIn(script), ['rimshot']);
check('and the words either side become their own takes', splitOnPads(script).filter(part => part.kind === 'words').length, 2);

say(process.exitCode ? 'FAILED' : 'all ok');
