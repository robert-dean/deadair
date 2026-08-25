/**
 * The productions table, against the real database.
 *
 * The unit tests cover the shapes and the arithmetic, which deserve to be tested without a stack.
 * What they cannot cover is this table, and every claim asked of it here has a real failure mode:
 *
 * - **the conditional claims**, which are the whole of how one job per pass works. A claim that
 *   quietly succeeded from the wrong state would let a duplicate delivery write two outlines over
 *   each other and leave the beats drafted against whichever landed second;
 * - **cancellation being terminal**, which is the one thing standing between an operator stopping a
 *   production and a broker resurrecting it minutes later — v1's gotcha, paid for live;
 * - **the row being the checkpoint**, since resuming after a restart is reading a state back rather
 *   than anything held in memory;
 * - **the beat link**, including the constraint that a beat with no place in its own programme
 *   cannot exist.
 *
 * It WRITES, and cleans up after itself in a `finally`: everything it creates is under one title
 * prefix and is deleted at the end whichever way the run goes.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/production.smoke.ts
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { ProductionRepository } from '../src/modules/productions/production.repository.js';
import { SegmentRepository } from '../src/modules/render/segment.repository.js';
import { planProduction } from '../src/modules/productions/production.plan.js';
import { StationIdentity } from '../src/modules/shared/station.identity.js';

/** Everything this run writes carries it, so the cleanup can be one statement. */
const TITLE = 'smoke:production';

const config = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();

const pool = new KyselyPool({
    host: config.get('DATABASE_HOST', ''),
    port: config.get('DATABASE_PORT', 55432),
    user: config.get('DATABASE_USER', ''),
    password: config.get('DATABASE_PASSWORD', ''),
    database: config.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

const identity = new StationIdentity();
const productions = new ProductionRepository(db, identity);
const segments = new SegmentRepository(db, identity);

let failures = 0;
const check = (ok: boolean, said: string): void => {
    console.log(`  ${ok ? '✓' : '✗'} ${said}`);
    if (!ok) failures += 1;
};

const open = async (overrides: Partial<Parameters<typeof productions.open>[0]> = {}) =>
    await productions.open({ kind: 'podcast', title: TITLE, targetMs: 10 * 60_000, writingMode: 'outlined', ...overrides });

try {
    console.log('productions');

    // ── what goes in comes back ───────────────────────────────────────────────
    const opened = await open({ brief: 'the history of the TR-808' });
    check(opened.state === 'planned', 'a production opens `planned`, which is what the first pass claims out of');
    check(opened.brief === 'the history of the TR-808', 'the brief comes back as it went in');
    check(opened.casting === undefined, 'nobody is cast at commission: the roster can change in the hours before the first pass runs');
    check(opened.scheduledFor === undefined, 'an unscheduled production reads as undefined rather than null');
    check(opened.writingMode === 'outlined', 'the writing mode comes back');

    // ── the claim is what makes one job per pass safe ─────────────────────────
    const first = await productions.claim(opened.id, 'planned', 'outlining');
    check(first?.state === 'outlining', 'a pass can claim a production out of the state it expects');

    const second = await productions.claim(opened.id, 'planned', 'outlining');
    check(second === undefined, 'a SECOND claim of the same pass finds nothing, so a duplicate delivery is free');

    const wrong = await productions.claim(opened.id, 'checking', 'rendering');
    check(wrong === undefined, 'a claim from a state the production is not in finds nothing');

    // ── the row is the checkpoint ─────────────────────────────────────────────
    const shape = planProduction(opened.targetMs);
    const saved = await productions.saveOutline(opened.id, { runners: ['the price'], beats: [{ title: 'One' }] }, shape, 'drafting', [
        { role: 'host', personaKey: 'classic', voice: 'classic' },
        { role: 'caller', personaKey: 'theorist', name: 'Dale', voice: 'theorist' },
    ]);
    check(saved, 'the outline pass writes its answer and moves the production on');

    const reread = await productions.findById(opened.id);
    check(reread?.state === 'drafting', 'a restart reads back which pass finished, which is the whole of resuming');
    check(reread?.outline?.beats[0]?.title === 'One', 'the outline comes back off the row');
    check(reread?.plan?.beats.length === shape.beats.length, 'the computed plan comes back beside it');
    check(reread?.casting?.[1]?.name === 'Dale', 'the cast comes back off the row, which is what a beat is rendered from');
    check(reread?.casting?.[1]?.role === 'caller', 'and it still says who was the caller');

    const staleOutline = await productions.saveOutline(opened.id, { runners: [], beats: [{ title: 'Two' }] }, shape, 'drafting');
    check(!staleOutline, 'a pass that no longer owns the production cannot write an outline over it');

    // ── a beat is a segment ───────────────────────────────────────────────────
    for (const beat of shape.beats.slice(0, 3)) {
        await segments.plan({
            kind: 'podcast',
            label: `${TITLE} (${beat.ordinal + 1})`,
            script: `beat ${beat.ordinal} says something`,
            productionId: opened.id,
            productionOrdinal: beat.ordinal,
        });
    }

    const beats = await segments.beatsOf(opened.id);
    check(beats.length === 3, 'the beats read back');
    check(
        beats.every((beat, index) => beat.productionOrdinal === index),
        'they come back in the order they are meant to be heard, from the database rather than the caller',
    );
    check(beats[0]?.productionId === opened.id, 'a beat knows which production it belongs to');

    let refused = false;
    try {
        await sql`insert into deadair.segments (station_key, kind, label, production_id) values ('main', 'podcast', ${TITLE}, ${opened.id})`.execute(
            db,
        );
    } catch {
        refused = true;
    }
    check(refused, 'a beat with no place in its own programme is refused by the table');

    // ── cancellation is terminal, because a queue cannot cancel ───────────────
    const running = await open();
    await productions.claim(running.id, 'planned', 'outlining');
    check(await productions.cancel(running.id), 'a production being made can be stopped');

    const afterCancel = await productions.findById(running.id);
    check(afterCancel?.state === 'cancelled', 'the row says so');
    check(afterCancel?.cancelledAt !== undefined, 'and says when, as epoch millis');
    check(await productions.isCancelled(running.id), 'a long pass asking mid-run is told to stop');

    // The whole point: everything already sent will still be delivered, so what has to fail is the
    // CLAIM rather than the delivery.
    const zombie = await productions.claim(running.id, 'outlining', 'drafting');
    check(zombie === undefined, 'a job delivered after the cancellation claims nothing, which is what makes the stop stick');
    check(!(await productions.fail(running.id, 'should not land')), 'a cancelled production is not then reported as failed');
    check(!(await productions.cancel(running.id)), 'cancelling twice is refused rather than rewriting when it happened');

    // ── failure keeps its reason ──────────────────────────────────────────────
    const broken = await open({ writingMode: 'quick' });
    check(await productions.fail(broken.id, 'beat 2 came back empty'), 'a production can be failed from any state');
    const failed = await productions.findById(broken.id);
    check(failed?.state === 'failed' && failed.error === 'beat 2 came back empty', 'the reason is on the row for whoever asks why');

    // ── what a scheduler drains ───────────────────────────────────────────────
    const unfinished = await productions.unfinished(50);
    const ids = new Set(unfinished.map(production => production.id));
    check(ids.has(opened.id), 'a production still being made is waiting to be drained');
    check(!ids.has(running.id) && !ids.has(broken.id), 'a settled one is not, whichever way it settled');
} finally {
    await sql`delete from deadair.segments where label like ${`${TITLE}%`}`.execute(db);
    await sql`delete from deadair.productions where title = ${TITLE}`.execute(db);
    await db.destroy();
}

console.log(failures === 0 ? '\nall good' : `\n${failures} failed`);
process.exitCode = failures === 0 ? 0 : 1;
