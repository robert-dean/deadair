/**
 * The silence diagnosis, against the real Icecast, the real Liquidsoap and the real
 * station row.
 *
 * The unit tests stub every one of those, because they have to: the ordering in
 * `diagnose` is a pure function and the point of it being pure is that the tests never
 * need a stack. What they cannot cover is the half this script exists for — that the
 * facts handed to it are the facts. Specifically:
 *
 * - that `AudienceWatch.reading()` moves `readAt` when Icecast answers and STOPS moving
 *   when it does not, which is what makes "zero listeners" and "nobody has answered"
 *   two facts rather than one number;
 * - that `PlayoutControlClient` reaches the address this install actually has, so
 *   `streamUnreachable` means the stream and not the config;
 * - that the heartbeat a loop registers is readable by the thing that judges it.
 *
 * It reads. It writes nothing, touches no setting and drives no transport, so it is
 * safe against a station that is on air.
 *
 * Run from `apps/api`:
 *   node --import @swc-node/register/esm-register ./scripts/silence.smoke.ts
 *
 * Pass `--watch` to keep polling, which is how to watch a reading go stale: run it,
 * stop Icecast, and watch the `answered Ns ago` line climb while the gate itself holds
 * whatever the last real answer was.
 *
 * Pass `--deaf` to watch the `streamUnreachable` grace period run: the control client is
 * pointed at a closed port, so the gate reports `waiting` for the first
 * `STREAM_DOWN_AFTER_MS` and `fault` after it. That transition is the whole of what the
 * grace period is, and it is invisible from a single reading, so `--deaf` implies
 * `--watch`.
 *
 * That the gate HOLDS is the point, and it is why there is no longer an
 * `audienceUnknown` cause to wait for. Only a positive reading moves the count, so an
 * Icecast that dies while somebody is listening does not take the station off air —
 * which is the opposite of what an unknown-audience gate did.
 */
import { AppConfigBuilder, AppConfigResolverEnv, AppConfigSourceDotenv } from '@maroonedsoftware/appconfig';
import { ConsoleLogger, type Logger } from '@maroonedsoftware/logger';
import { EncryptionProvider } from '@maroonedsoftware/encryption';
import { Kysely, PostgresDialect } from 'kysely';
import { KyselyDefaultPlugins, KyselyPgTypeOverrides, KyselyPool } from '@maroonedsoftware/kysely';

import type { DB } from '../src/modules/data/db.js';
import { settingsConfigSource } from '../src/server/settings.config.source.js';
import { resolveStreamSettings, streamMounts } from '../src/modules/stream/stream.settings.js';
import { IcecastEventFeed } from '../src/modules/stream/icecast.eventfeed.client.js';
import { IcecastStatsClient } from '../src/modules/stream/icecast.stats.client.js';
import { HlsAudience } from '../src/modules/stream/hls.audience.js';
import { StreamConfigWatch } from '../src/modules/stream/stream.staleness.js';
import { StationAirRepository } from '../src/modules/director/station.air.repository.js';
import { StationLineupRepository } from '../src/modules/director/station.lineup.repository.js';
import { AIR_MODE_KEY, parseAirMode } from '../src/modules/playout/air.mode.js';
import { AudienceWatch } from '../src/modules/playout/audience.watch.js';
import { LiquidsoapEndpoint } from '../src/modules/playout/liquidsoap.endpoint.js';
import { PlayoutControlClient } from '../src/modules/playout/liquidsoap.control.js';
import { diagnose, type StationFacts } from '../src/modules/playout/silence.diagnosis.js';
import { Heartbeat, HEARTBEATS } from '../src/modules/shared/heartbeat.js';
import { StationBus } from '../src/modules/shared/station.bus.js';

/**
 * Point the stats client at a closed port instead of the real Icecast.
 *
 * How to starve the reading without stopping a container. The station's own
 * Icecast is untouched and this process is the only thing looking at the dead address,
 * so it is safe to run against a station that is on air — which stopping the container
 * is not.
 */
const BLIND = process.argv.includes('--blind');
/**
 * The same trick against Liquidsoap's control API, for the `streamUnreachable` grace
 * period.
 *
 * That gate is the one thing here whose two states are both correct and differ only by a
 * clock: under `silence.diagnosis.ts`'s `STREAM_DOWN_AFTER_MS` an unanswered control API
 * is a container the station has just restarted for a settings change, and past it,
 * something an operator has to go and look at. Neither can be seen from a stack that is
 * up, and stopping the real one would take a live station off the air to test a message.
 */
const DEAF = process.argv.includes('--deaf');
// A transition is not a reading, so there is nothing for a single pass to show.
const WATCH = process.argv.includes('--watch') || DEAF;
/** Nothing listens here. Chosen over port 0, which binds rather than refuses. */
const CLOSED_PORT = '65533';
/** Long enough for the audience gate to change its mind, which is the interesting transition. */
const WATCH_INTERVAL_MS = 5_000;

const quiet = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as unknown as Logger;
/** The stats client's own complaints are worth hearing: a refused admin endpoint is the usual cause. */
const loud = new ConsoleLogger();

// The same two-step build `setup.server.ts` does, and not a shortcut: `deadair.settings`
// is a LAYER of the app's config, so anything that read only dotenv here would resolve the
// air mode and the mount to their defaults and then confidently diagnose a station that
// does not exist. `scrubProcessEnv` is deliberately not called — this process serves
// nothing, and scrubbing would only make the failure modes differ from the app's.
const boot = await new AppConfigBuilder()
    .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
    .addResolver(new AppConfigResolverEnv())
    .buildSnapshot();

const config = (
    await new AppConfigBuilder()
        .addSource(new AppConfigSourceDotenv(undefined, { groupSeparator: '__' }))
        .addSource(settingsConfigSource(boot, quiet))
        .addResolver(new AppConfigResolverEnv())
        .buildStore(quiet)
).toLiveConfig();

const pool = new KyselyPool({
    host: config.get('DATABASE_HOST', ''),
    port: config.get('DATABASE_PORT', 55432),
    user: config.get('DATABASE_USER', ''),
    password: config.get('DATABASE_PASSWORD', ''),
    database: config.get('DATABASE_NAME', ''),
    types: KyselyPgTypeOverrides,
});
const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }), plugins: [...KyselyDefaultPlugins] });

const stream = resolveStreamSettings(config, new EncryptionProvider(Buffer.from(boot.get('KMS_LOCAL_ROOT_KEY', ''), 'hex')));

// The same fields StreamModule.ready pushes in, from the same settings. The admin
// password matters: 2.5 serves the stats document from under `/admin/` and the roles it
// ships deny anonymous, so without it every poll fails and the station reads as blind.
// Every mount, not just the MP3 one, for the reason the audience is a sum over them:
// counting one would report a station nobody is listening to while somebody is on Opus.
const stats = new IcecastStatsClient(config, loud);
stats.useMounts({
    host: stream.icecastHost,
    port: BLIND ? CLOSED_PORT : stream.icecastPort,
    mount: stream.mount,
    alsoMounts: streamMounts(stream)
        .slice(1)
        .map(mount => mount.path),
    adminPassword: stream.adminPassword,
});
if (BLIND) console.log(`--blind: asking ${stream.icecastHost}:${CLOSED_PORT} instead of ${stream.icecastPort}. The real icecast is untouched.`);

const heartbeat = new Heartbeat();
// The HLS half of the audience is an empty register here and stays one: it is fed by the
// playlist requests the API serves, and this process serves none. So what is reported is
// Icecast's count alone, which is the half every gate below is about.
const audience = new AudienceWatch(stats, new IcecastEventFeed(stats, quiet), new HlsAudience(), config, heartbeat, new StationBus(quiet), quiet);

/**
 * A control endpoint pinned to an address nothing answers, for `--deaf`.
 *
 * Answered without probing, exactly as a configured `LIQUIDSOAP_CONTROL_URL` is, so every
 * call fails at the connect and `PlayoutControlClient` stamps `downSince` on the first
 * one. `invalidate()` cannot clear it, which is the point: the stream stays down for the
 * whole run and the grace period gets to expire.
 */
class ClosedEndpoint extends LiquidsoapEndpoint {
    async resolve(): Promise<string> {
        return `http://127.0.0.1:${CLOSED_PORT}`;
    }
}

const endpoint = DEAF ? new ClosedEndpoint(config, quiet) : new LiquidsoapEndpoint(config, quiet);
endpoint.useSecret(stream.playoutBridgeSecret ?? '');
const control = new PlayoutControlClient(endpoint, new StreamConfigWatch(stats, quiet), quiet);
if (DEAF) console.log(`--deaf: control calls go to 127.0.0.1:${CLOSED_PORT}. The real liquidsoap is untouched and still holding the mount.`);

const air = new StationAirRepository(db);
const lineup = new StationLineupRepository(db);

audience.start();

/**
 * What one pass has to say: the facts the gates read, plus how long ago Icecast
 * last answered.
 *
 * The second is deliberately NOT on `StationFacts`. It used to be, as
 * `sinceAudienceAnswerMs`, feeding an `audienceUnknown` gate that has since been
 * removed — a failed poll now leaves the last count standing rather than reading
 * as an empty room — and a field no gate reads has no business in the snapshot
 * the gates are handed. It is still worth PRINTING, because a reading that has
 * stopped moving is the whole thing `--blind` exists to show.
 */
interface Pass {
    facts: StationFacts;
    /** Absent means Icecast has not answered once since this process started. */
    sinceAnswerMs?: number;
}

/**
 * One reading, assembled the way `PlayoutService.getStatus` assembles it.
 *
 * Two facts come from somewhere else than they do in the app, and both are called out
 * where they are read: this process has no rundown and no reconcile loop of its own.
 */
async function snapshot(): Promise<Pass> {
    const now = Date.now();

    // A real call, which is what makes `streamUp` mean the stream rather than the config:
    // a pinned LIQUIDSOAP_CONTROL_URL resolves without being probed.
    await control.status();

    const stationAir = await air.get();
    const order = await lineup.load();
    const reading = audience.reading();
    // Read once each rather than in the spreads below, the way `diagnoseSilence` reads them:
    // asked twice, the second answer is a different moment from the one the branch was taken
    // on, and each of these is an edge that can clear between the two.
    const downSince = control.downSince();
    const deniedSince = control.deniedSince();
    const starvedSince = control.starvedSince();

    const facts: StationFacts = {
        now,
        // The API judges its own reconcile loop. This process does not have one, so the
        // heartbeat is registered and beaten here purely to prove the wiring reads back;
        // a stalled transport is the one gate this script cannot honestly observe.
        ...(heartbeat.stalledFor(HEARTBEATS.audiencePoll, now) === undefined ? {} : { reconcileStalledForMs: 0 }),
        streamUp: control.isUp(),
        // The two clocks under the stream gates, gathered the way `diagnoseSilence` does.
        // Without the first, a control API that has been unreachable for two seconds because
        // the station restarted it for a settings change reports as a fault with a remedy
        // telling the operator to go and look at a container that is doing as it was told.
        ...(downSince === undefined ? {} : { streamDownForMs: now - downSince }),
        // Its neighbour, and gathered here for the same reason it is ranked above that one:
        // a refused bridge secret fails every call exactly as an absent stream does, and
        // omitting it would have this script name the wrong fault for it.
        ...(deniedSince === undefined ? {} : { controlDeniedForMs: now - deniedSince }),
        driving: control.isOnAir(),
        // Nothing rendered in this process, so there is nothing to have gone stale against.
        staleConfig: [],
        active: stationAir?.active ?? false,
        // The app answers this from the LIVE rundown, which is memory in the API process.
        // The persisted order is the closest thing available here, and it is the same
        // question one step behind: anything still to come means there is a programme.
        hasProgramme: (order?.all() ?? []).some(item => item.state === 'planned' || item.state === 'handed' || item.state === 'airing'),
        airMode: parseAirMode(config.get(AIR_MODE_KEY, '')),
        listeners: reading.count,
        audience: reading.hasAudience,
        // Pushed by Liquidsoap to a route this process is not serving.
        ...(starvedSince === undefined ? {} : { starvedForMs: now - starvedSince }),
    };

    return { facts, ...(reading.readAt === undefined ? {} : { sinceAnswerMs: now - reading.readAt }) };
}

function report({ facts, sinceAnswerMs }: Pass): void {
    const silence = diagnose(facts);

    console.log(`\n${silence.audible ? '● AIRING' : '○ SILENT'}  ${silence.cause}`);
    console.log(`  ${silence.detail}`);
    if (silence.remedy) console.log(`  → ${silence.remedy}`);

    console.log('\n  gates');
    for (const check of silence.checks) {
        const mark = check.state === 'ok' ? '✓' : check.state === 'waiting' ? '·' : '✗';
        console.log(`  ${mark} ${check.code.padEnd(18)} ${check.detail}`);
    }

    // How long it has been gone, spelled out beside the gate: `streamUnreachable` reads
    // `waiting` and then `fault` off this one number, and without it the line flipping from
    // `·` to `✗` looks like the check changing its mind rather than a clock running out.
    const down = facts.streamDownForMs === undefined ? '' : ` for ${Math.round(facts.streamDownForMs / 1000)}s`;

    console.log(
        `\n  icecast: ${sinceAnswerMs === undefined ? 'has never answered' : `answered ${Math.round(sinceAnswerMs / 1000)}s ago`}` +
            `, ${facts.listeners} listening` +
            `  |  liquidsoap: ${facts.streamUp ? 'up' : `unreachable${down}`}${facts.driving ? ', driving' : ''}` +
            `  |  station: ${facts.active ? 'active' : 'stood down'}`,
    );
}

// One reading before anything else, so a run against a station nobody has touched still
// says something, then the poll if asked.
report(await snapshot());

if (!WATCH) {
    audience.stop();
    await db.destroy();
    process.exit(0);
}

console.log(
    `\nwatching every ${WATCH_INTERVAL_MS}ms; ` +
        (DEAF
            ? 'streamUnreachable reads `waiting` while the grace period lasts and `fault` once it expires, about 30s in.'
            : 'stop icecast to see the audience gate change its mind.') +
        ' ctrl-c to stop.',
);
setInterval(() => void snapshot().then(report), WATCH_INTERVAL_MS);
