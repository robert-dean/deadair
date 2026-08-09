// The reactor is the one thing here with a listener on the other end. What is
// tested is mostly restraint: it commits a few items and no more, it does not
// put a stood-down station back on air, and it does not queue a refill per
// rundown event. The stand-down case is the load-bearing one — an app that kept
// committing after Stop would have the station broadcasting a second after the
// operator stopped it.

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';

import { DirectorService } from '../../../src/modules/director/director.service.js';
import { Lineup, type LineupMode, type LineupOnEnd } from '../../../src/modules/director/lineup.js';
import { LineupRepository } from '../../../src/modules/director/lineup.repository.js';
import { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { StationAirRepository, type StationAir } from '../../../src/modules/director/station.air.repository.js';
import { settingsConfig } from '../../utils/settings.config.js';
import { ROTATION_KEYS } from '../../../src/modules/director/rotation.rules.js';
import { AIR_MODE_KEY, type AirMode } from '../../../src/modules/playout/air.mode.js';
import type { AudienceWatch } from '../../../src/modules/playout/audience.watch.js';
import { Rundown, type RundownTrack } from '../../../src/modules/playout/rundown.js';
import { TrackResolver } from '../../../src/modules/playout/playout.capability.js';
import { BreakPlanner } from '../../../src/modules/director/break.planner.js';
import { SegmentRepository, type Segment } from '../../../src/modules/render/segment.repository.js';
import { RENDER_PLUGIN_ID } from '../../../src/modules/render/segment.source.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

class StubResolver extends TrackResolver {
    async resolve(): Promise<string> {
        return 'https://example.test/audio.ogg';
    }
}

const track = (externalId: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId,
    title: `Track ${externalId}`,
    artists: ['An Artist'],
});

interface Options {
    air?: Partial<StationAir>;
    items?: string[];
    mode?: LineupMode;
    onEnd?: LineupOnEnd;
    /** A second lineup the air row can be pointed at. */
    other?: { id: string; items: string[] };
    /** What the stored air mode says, if anything is stored at all. */
    airMode?: AirMode;
    /** What the segment library holds, for the lines a lineup names by id. */
    segments?: Partial<Segment>[];
}

function build(options: Options = {}) {
    const rundown = new Rundown(new StubResolver(), logger);

    const lineup = new Lineup({
        id: 'lineup-1',
        name: 'Afternoons',
        mode: options.mode ?? 'rotation',
        onEnd: options.onEnd ?? 'extend',
        source: 'import',
    });

    const other = options.other
        ? new Lineup({ id: options.other.id, name: 'Other', mode: 'rotation', onEnd: 'extend', source: 'import' })
        : undefined;

    let air: StationAir | undefined = {
        slot: 'main',
        lineupId: 'lineup-1',
        cursor: 0,
        active: true,
        ...options.air,
    };

    const lineups = {
        // Honours the cursor the way the real repository does: it is loaded FROM the air row, so a
        // fake that ignored it could not show the reactor picking up a cursor moved underneath it —
        // which is the case that used to leave the station stuck at the end of a lineup.
        load: vi.fn(async (id: string, cursor = 0) => {
            const found = id === 'lineup-1' ? lineup : id === other?.id ? other : undefined;
            found?.advance(cursor);
            return found;
        }),
    } as unknown as LineupRepository;

    const airRepository = {
        get: vi.fn(async () => air),
        standDown: vi.fn(async () => {
            air = air ? { ...air, active: false } : air;
        }),
        resume: vi.fn(async (lineupId: string, cursor: number) => {
            air = { slot: 'main', lineupId, cursor, active: true };
        }),
        putOnAir: vi.fn(async (lineupId: string) => {
            air = { slot: 'main', lineupId, cursor: 0, active: true };
        }),
    } as unknown as StationAirRepository;

    const history = { record: vi.fn(async () => {}) } as unknown as PlayHistoryRepository;

    // The air mode is a SETTING, and settings are a layer of the app's config now, so it reaches
    // the director and the audience gate through this rather than through a scoped repository.
    const station = settingsConfig(options.airMode === undefined ? {} : { [AIR_MODE_KEY]: options.airMode });

    // Real, over the fake repository: where a break belongs is BreakPlanner's own decision and is
    // tested there, and stubbing it here would leave the wiring — that the reactor plants at all,
    // and does it before committing — untested.
    // Nothing can write here, so it plants recorded idents: what this file is testing is that the
    // reactor plants at all and does it before committing, and the written path has its own tests
    // next door.
    const breaks = new BreakPlanner(
        {
            listReady: vi.fn(async () => [{ id: 'ident-1', kind: 'ident', state: 'ready', label: 'Ident', source: 'library' }]),
        } as unknown as SegmentRepository,
        { canWrite: () => false } as never,
        { speaker: () => undefined } as never,
        { send: vi.fn(async () => {}) } as never,
        logger,
    );

    const library = new Map((options.segments ?? []).map(segment => [segment.id!, segment as Segment]));
    // A mutable stub rather than a frozen fake: two tests replace the lookup to hold the pass open
    // mid-commit, or to fail it, which is the only way to reach the window this class guards.
    const segmentStub = {
        findByIds: vi.fn(async (ids: readonly string[]) => new Map([...library].filter(([id]) => ids.includes(id)))),
    };
    const segments = segmentStub as unknown as SegmentRepository;

    const scope = {
        get: vi.fn((token: unknown) =>
            token === LineupRepository
                ? lineups
                : token === StationAirRepository
                  ? airRepository
                  : token === SegmentRepository
                    ? segments
                    : token === BreakPlanner
                      ? breaks
                      : history,
        ),
        disposeAsync: vi.fn(async () => {}),
    };
    const createScope = vi.fn(() => scope);
    const container = { createScopedContainer: createScope } as unknown as Container;

    // The singleton broker, which is what JobsModule documents for a non-request caller.
    const jobs = { send: vi.fn(async () => 'job-1') };

    // A stub: what the gate does to the mount is PlayoutPusher's, and is tested there. The
    // director no longer tells it anything — it reads the same setting from the same config.
    const audience = {} as unknown as AudienceWatch;

    const director = new DirectorService(rundown, audience, container, jobs as unknown as PgBossJobBroker, station.config, logger);

    return {
        director,
        station,
        container,
        createScope,
        scope,
        rundown,
        lineups,
        breaks,
        segmentStub,
        lineup,
        other,
        jobs,
        history,
        airRepository,
        audience,
        seed: async () => lineup.append((options.items ?? ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']).map(track)),
        setAir: (next: StationAir | undefined) => {
            air = next;
        },
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

/** Let the pending microtasks of a commit pass settle. */
const settle = () => new Promise(resolve => setImmediate(resolve));

/**
 * One wake, with no side effect on the running order.
 *
 * `next()` on an empty queue announces a change and hands nothing back, which is
 * exactly what the pusher produces every couple of seconds on an idle station.
 */
const wake = async (rundown: Rundown) => {
    await rundown.next();
    await settle();
};

describe('DirectorService committing', () => {
    it('commits a few items and no more', async () => {
        // The lineup is the deep plan and the rundown is a window onto it. Committing
        // further ahead only takes items out of an operator's reach.
        const { director, rundown, seed } = build();
        await seed();

        await director.start();

        expect(rundown.upcoming()).toHaveLength(3);
    });

    it('advances the lineup cursor by exactly what it committed', async () => {
        const { director, lineup, seed } = build();
        await seed();

        await director.start();

        expect(lineup.cursor()).toBe(3);
    });

    it('refills the window as the player consumes it', async () => {
        const { director, rundown, seed } = build();
        await seed();
        await director.start();

        // The pusher takes one and the player confirms it: the rundown is a track
        // short, and the change event is what tells the director to top it back up.
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        await new Promise(resolve => setImmediate(resolve));

        expect(rundown.upcoming()).toHaveLength(3);
    });

    it('does not commit anything for a station that was stood down', async () => {
        // The whole reason `active` is stored. An app that came back committing would
        // put a station on air that somebody deliberately stopped.
        const { director, rundown, seed } = build({ air: { active: false } });
        await seed();

        await director.start();

        expect(rundown.upcoming()).toHaveLength(0);
    });

    it('commits nothing when nothing is on air', async () => {
        const { director, rundown, setAir } = build();
        setAir(undefined);

        await director.start();

        expect(rundown.upcoming()).toHaveLength(0);
    });
});

describe('DirectorService reading the air mode', () => {
    it('reports the stored mode alongside what is on air', async () => {
        const { director, seed } = build({ airMode: 'always' });
        await seed();

        await director.start();

        expect(director.status().airMode).toBe('always');
    });

    it('reports airing for an audience when nothing is stored', async () => {
        const { director, seed } = build();
        await seed();

        await director.start();

        expect(director.status().airMode).toBe('audience');
    });

    it('notices a change made elsewhere without being told, and without re-reading anything', async () => {
        // The mode is a setting an operator can change from anywhere, and the console is not the
        // only writer this has to survive. It used to be re-read on the same throttle as
        // `station_air` and then pushed into the audience gate; now it is simply read from the
        // config, so there is no window in which this and the gate disagree about it.
        const { director, station, seed } = build();
        await seed();
        await director.start();

        expect(director.status().airMode).toBe('audience');

        station.set(AIR_MODE_KEY, 'always');

        // No `reload()`, no tick, nothing invalidated.
        expect(director.status().airMode).toBe('always');
    });

    it('falls back rather than throwing on a value nobody recognises', async () => {
        // Somebody typed into the settings table by hand. This is read on the path that decides
        // whether the station airs at all, so the safe direction is the default rather than an
        // exception out of a getter.
        const { director, station, seed } = build();
        await seed();
        await director.start();

        station.set(AIR_MODE_KEY, 'sometimes');

        expect(director.status().airMode).toBe('audience');
    });
});

describe('DirectorService noticing the row', () => {
    it('picks up a station switched on out of band, without being told', async () => {
        // Checking a remembered `active` flag before reading the row means a station
        // that was off when this process started can never notice being switched on
        // by anything that did not call in — a scheduler, a second process, an
        // operator editing the row. Caught by a live run: the director sat idle while
        // station_air said it was on air.
        const { director, rundown, setAir, seed } = build({ air: { active: false } });
        await seed();
        await director.start();
        expect(rundown.upcoming()).toHaveLength(0);

        setAir({ slot: 'main', lineupId: 'lineup-1', cursor: 0, active: true });
        await wake(rundown);

        expect(rundown.upcoming().length).toBeGreaterThan(0);
        expect(director.status().active).toBe(true);
    });

    it('goes off air when the row says so, without being told either', async () => {
        const { director, rundown, setAir, seed } = build();
        await seed();
        await director.start();
        expect(rundown.upcoming()).toHaveLength(3);

        setAir({ slot: 'main', lineupId: 'lineup-1', cursor: 3, active: false });
        // Forced past the throttle the way a stand-down does, since this station IS on
        // air and a busy director does not re-read on every single wake.
        await director.reload();

        expect(director.status().active).toBe(false);
    });
});

describe('DirectorService standing down', () => {
    it('stops committing when the transport is stopped', async () => {
        // `PlayoutService.stop` resets the rundown. If the director did not hear that,
        // its next pass would refill the running order and the station would be back
        // on air a second after the operator stopped it.
        const { director, rundown, seed } = build();
        await seed();
        await director.start();

        rundown.reset();
        await new Promise(resolve => setImmediate(resolve));

        expect(rundown.upcoming()).toHaveLength(0);
        expect(director.status().active).toBe(false);
    });

    it('does not resume in the window before the stand-down has been written', async () => {
        // `Rundown.reset` calls its listeners synchronously, so there is a moment
        // between Stop and the row saying so. A wake landing there reads the OLD row,
        // sees `active: true`, and puts the station straight back on air.
        const { director, rundown, airRepository, seed } = build();
        await seed();
        await director.start();

        // A write that has not landed yet, exactly as a real one has not.
        let release = () => {};
        vi.mocked(airRepository.standDown).mockImplementationOnce(
            async () =>
                new Promise<void>(resolve => {
                    release = resolve;
                }),
        );

        rundown.reset();
        await wake(rundown);

        expect(rundown.upcoming()).toHaveLength(0);
        expect(director.status().active).toBe(false);

        release();
    });

    it('records the stand-down, so a restart stays down', async () => {
        const { director, rundown, airRepository, seed } = build();
        await seed();
        await director.start();

        rundown.reset();
        await new Promise(resolve => setImmediate(resolve));

        expect(airRepository.standDown).toHaveBeenCalled();
    });

    it('ignores a replacement, which is not a stand-down', async () => {
        // `load` announces a reset too, but the station is still on air playing what
        // it was playing; only the order behind it changed.
        const { director, rundown, seed } = build();
        await seed();
        await director.start();

        rundown.load([track('x')]);
        await new Promise(resolve => setImmediate(resolve));

        expect(director.status().active).toBe(true);
    });
});

describe('DirectorService history', () => {
    it('records what the player confirmed, not what it was handed', async () => {
        // The two are a lead apart: the item being committed now is three tracks from
        // being heard, and history that recorded it would suppress a song nobody played.
        const { director, rundown, history, seed } = build();
        await seed();
        await director.start();

        const pulled = await rundown.next();
        expect(history.record).not.toHaveBeenCalled();

        rundown.markAired(pulled!.item.id);
        await new Promise(resolve => setImmediate(resolve));

        expect(history.record).toHaveBeenCalledOnce();
        expect(vi.mocked(history.record).mock.calls[0]![0]!.item.externalId).toBe('a');
    });
});

describe('DirectorService refilling', () => {
    it('sends one refill when the tail runs short, however many events arrive', async () => {
        // A burst of rundown changes would otherwise queue a dozen identical jobs for
        // one shortfall.
        const { director, rundown, jobs, seed } = build({ items: ['a', 'b', 'c', 'd'] });
        await seed();
        await director.start();

        for (let index = 0; index < 3; index++) {
            const pulled = await rundown.next();
            if (pulled) rundown.markAired(pulled.item.id);
            await new Promise(resolve => setImmediate(resolve));
        }

        expect(vi.mocked(jobs.send).mock.calls.filter(call => call[0] === 'director.extend_lineup')).toHaveLength(1);
    });

    it('never refills a setlist, which is finite on purpose', async () => {
        const { director, jobs, seed } = build({ items: ['a', 'b'], mode: 'setlist' });
        await seed();

        await director.start();

        expect(jobs.send).not.toHaveBeenCalled();
    });
});

describe('DirectorService at the end of a lineup', () => {
    it('wraps a setlist back to the top', async () => {
        const { director, rundown, lineup, seed } = build({ items: ['a', 'b'], mode: 'setlist', onEnd: 'repeat' });
        await seed();

        await director.start();

        // Two items, a lead of three: the setlist wrapped rather than running out.
        expect(rundown.upcoming().map(item => item.externalId)).toEqual(['a', 'b', 'a']);
        expect(lineup.cursor()).toBe(1);
    });

    it('stands the station down when a lineup says to stop', async () => {
        const { director, rundown, seed } = build({ items: ['a'], mode: 'feature', onEnd: 'stop' });
        await seed();

        await director.start();
        await new Promise(resolve => setImmediate(resolve));

        expect(director.status().active).toBe(false);
        expect(rundown.upcoming()).toHaveLength(0);
    });

    it('hands the station back to what a feature interrupted', async () => {
        const { director, airRepository, seed } = build({
            items: ['a'],
            mode: 'feature',
            onEnd: 'resume',
            air: { resumeLineupId: 'lineup-2', resumeCursor: 4 },
            other: { id: 'lineup-2', items: ['x', 'y'] },
        });
        await seed();

        await director.start();

        expect(airRepository.resume).toHaveBeenCalledWith('lineup-2', 4);
    });

    it('stands down rather than guessing when there is nothing to resume', async () => {
        const { director, seed } = build({ items: ['a'], mode: 'feature', onEnd: 'resume' });
        await seed();

        await director.start();
        await new Promise(resolve => setImmediate(resolve));

        expect(director.status().active).toBe(false);
    });

    it('falls to the slot home programming when one is named', async () => {
        const { director, airRepository, seed } = build({
            items: ['a'],
            mode: 'feature',
            onEnd: 'rotation',
            air: { defaultLineupId: 'lineup-2' },
            other: { id: 'lineup-2', items: ['x', 'y'] },
        });
        await seed();

        await director.start();

        expect(airRepository.putOnAir).toHaveBeenCalledWith('lineup-2');
    });

    it('stands down when no home programming has been named', async () => {
        // Naming none is a choice, not an oversight to paper over with a lineup
        // nobody picked.
        const { director, seed } = build({ items: ['a'], mode: 'feature', onEnd: 'rotation' });
        await seed();

        await director.start();
        await new Promise(resolve => setImmediate(resolve));

        expect(director.status().active).toBe(false);
    });
});

describe('DirectorService switching', () => {
    it('picks up a lineup put on air out of band', async () => {
        const { director, setAir, other, seed } = build({ other: { id: 'lineup-2', items: ['x', 'y'] } });
        await seed();
        await other!.append([track('x'), track('y')]);
        await director.start();

        setAir({ slot: 'main', lineupId: 'lineup-2', cursor: 0, active: true });
        await director.reload();

        expect(director.status().lineupId).toBe('lineup-2');
    });
});

// A lineup line can be a segment: an ident, a stinger, a talk break. The director is the only
// thing that turns one into something the player can be handed, and the rule it enforces is the
// one the whole design rests on — a segment that is not ready is SKIPPED, never waited for.
describe('DirectorService committing segments', () => {
    const READY = { id: 'seg-1', kind: 'ident', state: 'ready' as const, label: 'Top of the hour', source: 'library' };

    it('commits a ready segment as an ordinary item, so nothing downstream has to know what it is', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b'], segments: [READY] });
        await seed();
        await lineup.insertSegment('seg-1', 1);

        await director.start();
        await settle();

        const committed = rundown.upcoming();
        expect(committed[1]).toMatchObject({ pluginId: RENDER_PLUGIN_ID, externalId: 'seg-1', title: 'Top of the hour' });
        // Empty rather than the station's name: `itemAnnotations` drops an empty value, so the
        // mount reads "Top of the hour" instead of "Top of the hour - Deadair".
        expect(committed[1]?.artists).toEqual([]);
    });

    it('skips a segment that has no audio yet rather than holding the slot open', async () => {
        const { director, lineup, rundown, seed } = build({
            items: ['a', 'b', 'c'],
            segments: [{ id: 'seg-1', kind: 'talkbreak', state: 'planned', label: 'A talk break', source: 'render' }],
        });
        await seed();
        await lineup.insertSegment('seg-1', 1);

        await director.start();
        await settle();

        // The three lines taken were a, the segment, and b — and the lead is still full. Appending
        // to the rundown emits a change, which the commit pass coalesces into the `pending` wake it
        // fires on its way out, and that pass takes `c`. So a skipped segment costs the running
        // order nothing at all, not even until the next reconcile.
        expect(rundown.upcoming().map(item => item.externalId)).toEqual(['a', 'b', 'c']);
    });

    // The lineup names it and the library no longer holds it: same outcome as one that is not
    // ready, and distinguishable only in the log.
    it('skips a segment the library has lost', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b'], segments: [] });
        await seed();
        await lineup.insertSegment('seg-1', 1);

        await director.start();
        await settle();

        expect(rundown.upcoming().every(item => item.pluginId !== RENDER_PLUGIN_ID)).toBe(true);
    });

    // Play history steers what plays NEXT: the repeat window and the artist cooldown are both
    // reads of it. A row for an ident would have the station suppressing its own idents.
    it('keeps a segment out of play history when it airs', async () => {
        const { director, lineup, rundown, history, seed } = build({ items: ['a', 'b'], segments: [READY] });
        await seed();
        await lineup.insertSegment('seg-1', 0);
        await director.start();
        await settle();

        const segmentItem = rundown.upcoming().find(item => item.pluginId === RENDER_PLUGIN_ID)!;
        await rundown.next();
        rundown.markAired(segmentItem.id);
        await settle();

        expect(history.record).not.toHaveBeenCalled();
    });

    it('still records a record that airs', async () => {
        const { director, rundown, history, seed } = build({ items: ['a', 'b'] });
        await seed();
        await director.start();
        await settle();

        const first = rundown.upcoming()[0]!;
        await rundown.next();
        rundown.markAired(first.id);
        await settle();

        expect(history.record).toHaveBeenCalledOnce();
    });
});

// The refill job plants breaks among the records it appends, which covers a rotation. This pass is
// what covers a lineup nothing ever refills — an imported provider playlist above all, which would
// otherwise play for an hour without once saying what station it is.
describe('DirectorService planting breaks', () => {
    it('plants into a lineup nothing will ever extend', async () => {
        const { director, lineup, seed } = build({ items: Array.from({ length: 20 }, (_, index) => `t${index}`) });
        await seed();

        await director.start();
        await settle();

        expect(lineup.all().some(item => item.kind === 'segment')).toBe(true);
    });

    it('plants before it commits, so a break is never left behind the records just handed over', async () => {
        const { director, lineup, seed } = build({ items: Array.from({ length: 20 }, (_, index) => `t${index}`) });
        await seed();

        await director.start();
        await settle();

        // Everything planted is still ahead of the cursor: nothing was dropped into the part of the
        // order the player is already holding.
        const planted = lineup.all().flatMap((item, index) => (item.kind === 'segment' ? [index] : []));
        expect(planted.every(index => index >= lineup.cursor())).toBe(true);
    });

    it('plants at the spacing the operator set, not at the built-in default', async () => {
        // The whole point of the rules becoming settings: this is the first one an operator can
        // change and hear the difference, with no redeploy and no restart.
        const { director, lineup, station, seed } = build({ items: Array.from({ length: 20 }, (_, index) => `t${index}`) });
        station.set(ROTATION_KEYS.breakEveryItems, '2');
        await seed();

        await director.start();
        await settle();

        const spacing = lineup
            .all()
            .flatMap((item, index) => (item.kind === 'segment' ? [index] : []))
            .slice(0, 2);
        // Two records between breaks rather than the default four, so the first two planted slots
        // are three apart rather than five.
        expect(spacing[1]! - spacing[0]!).toBe(3);
    });

    it('plants nothing when the operator has turned breaks off', async () => {
        const { director, lineup, station, seed } = build({ items: Array.from({ length: 20 }, (_, index) => `t${index}`) });
        station.set(ROTATION_KEYS.breaks, 'false');
        await seed();

        await director.start();
        await settle();

        expect(lineup.all().some(item => item.kind === 'segment')).toBe(false);
    });

    // A break is the one thing in a commit pass the broadcast does not depend on: the records
    // either side of it play regardless.
    it('keeps the running order full when the planner throws', async () => {
        const { director, rundown, breaks, seed } = build();
        breaks.plant = vi.fn(async () => {
            throw new Error('the library is unreachable');
        });
        await seed();

        await director.start();
        await settle();

        expect(rundown.upcoming()).toHaveLength(3);
    });
});

// The commit pass reads what is on air, plants breaks and looks segments up before it hands
// anything over, and the event loop is free at every one of those awaits. The operator's Stop lands
// there, synchronously, from a request handler on the same thread. A pass that trusted the checks
// it made at the top would resume on the far side of a decision that has already been reversed.
describe('DirectorService committing across a change underneath it', () => {
    it('commits nothing when the station is stood down mid-pass', async () => {
        const { director, rundown, lineup, segmentStub, seed } = build({
            items: ['a', 'b', 'c'],
            segments: [{ id: 'seg-1', kind: 'ident', state: 'ready', label: 'Ident', source: 'library' }],
        });
        await seed();
        // A segment at the head, so the pass must await a lookup before it can commit anything.
        await lineup.insertSegment('seg-1', 0);

        let began: (() => void) | undefined;
        const started = new Promise<void>(resolve => (began = resolve));
        let unblock: (() => void) | undefined;
        const held = new Promise<void>(resolve => (unblock = resolve));
        segmentStub.findByIds = vi.fn(async () => {
            began?.();
            await held;
            return new Map<string, Segment>();
        });

        const starting = director.start();
        await started;

        // The Stop, landing exactly inside the lookup.
        rundown.reset();
        unblock!();
        await starting;
        await settle();

        expect(rundown.upcoming()).toHaveLength(0);
        expect(director.status().active).toBe(false);
    });

    // A cursor advanced before the lines are usable loses them for good: they sit behind it and
    // nothing offers them again. A lookup that throws is the ordinary way to get there.
    it('leaves the cursor alone when the work before the hand-over fails', async () => {
        const { director, lineup, segmentStub, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();
        await lineup.insertSegment('seg-1', 0);
        segmentStub.findByIds = vi.fn(async () => {
            throw new Error('the database is gone');
        });

        await director.start().catch(() => undefined);
        await settle();

        // All four lines are still ahead of the cursor and will be offered again.
        expect(lineup.cursor()).toBe(0);
        expect(lineup.remaining()).toBe(4);
    });
});

// A talk-over is heard ALONGSIDE a record rather than in the gap before it, so it never becomes a
// line of the running order. It rides on the record that follows and the pusher arms it as that
// record is handed over.
describe('DirectorService committing a talk-over', () => {
    const READY = { id: 'seg-1', kind: 'talkbreak', state: 'ready' as const, label: 'Over the intro', source: 'library' };

    it('attaches it to the record that follows rather than committing it as an item', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b', 'c'], segments: [READY] });
        await seed();
        await lineup.insertSegment('seg-1', 1, undefined, { atMs: 8000 });

        await director.start();
        await settle();

        const committed = rundown.upcoming();
        // Three records, no extra item for the segment.
        expect(committed.map(item => item.externalId)).toEqual(['a', 'b', 'c']);
        expect(committed[0]?.voice).toBeUndefined();
        expect(committed[1]?.voice).toEqual({ segmentId: 'seg-1', atMs: 8000 });
    });

    // A batch is three items, so a talk-over planted before the last record of one has nothing in
    // that batch to ride on. Dropping it would silently lose about a third of them.
    it('holds one whose record is in the next batch', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b', 'c', 'd'], segments: [READY] });
        await seed();
        // After a, b, c — so it is the last line of the first batch of three.
        await lineup.insertSegment('seg-1', 3, undefined, { atMs: 5000 });

        await director.start();
        await settle();
        expect(rundown.upcoming().some(item => item.voice !== undefined)).toBe(false);

        // The player takes one, which is what makes room for the next commit.
        const pulled = await rundown.next();
        rundown.markAired(pulled!.item.id);
        await settle();

        expect(rundown.upcoming().find(item => item.externalId === 'd')?.voice).toEqual({ segmentId: 'seg-1', atMs: 5000 });
    });

    // Two voices at once is the one outcome nobody wants; queueing them would produce exactly that.
    it('keeps the later of two talk-overs in a row', async () => {
        const { director, lineup, rundown, seed } = build({
            items: ['a', 'b'],
            segments: [READY, { id: 'seg-2', kind: 'talkbreak', state: 'ready', label: 'Also over the intro', source: 'library' }],
        });
        await seed();
        await lineup.insertSegment('seg-1', 1, undefined, { atMs: 1000 });
        await lineup.insertSegment('seg-2', 2, undefined, { atMs: 2000 });

        await director.start();
        await settle();

        expect(rundown.upcoming().find(item => item.externalId === 'b')?.voice).toEqual({ segmentId: 'seg-2', atMs: 2000 });
    });

    // A cue is about a particular record in a particular running order. One held across a
    // stand-down would attach itself to the first record of whatever came next.
    it('forgets a held talk-over when the station stands down', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b', 'c', 'd'], segments: [READY] });
        await seed();
        await lineup.insertSegment('seg-1', 3, undefined, { atMs: 5000 });
        await director.start();
        await settle();

        rundown.reset();
        await settle();
        await director.reload();
        await settle();

        expect(rundown.upcoming().every(item => item.voice === undefined)).toBe(true);
    });

    // Without `over` it is an ordinary segment and airs in the gap, which is phase 2's path and
    // stays the default.
    it('leaves a plain segment as an item of its own', async () => {
        const { director, lineup, rundown, seed } = build({ items: ['a', 'b'], segments: [READY] });
        await seed();
        await lineup.insertSegment('seg-1', 1);

        await director.start();
        await settle();

        expect(rundown.upcoming()[1]).toMatchObject({ externalId: 'seg-1' });
        expect(rundown.upcoming().every(item => item.voice === undefined)).toBe(true);
    });
});

// The reactor holds the lineup it is airing in memory, so anything that changes the plan has to be
// able to tell it. Doing that as a flag consumed on a TIMER, rather than at the top of a commit
// pass, is the whole point: `putOnAir` calls `Rundown.load([])`, whose change event fires a pass
// synchronously and still inside the request whose transaction has not committed. A pass that
// consumed the flag would re-read the state from before the write that prompted it.
describe('DirectorService noticing the plan changed', () => {
    const loadCount = (lineups: LineupRepository) => (lineups.load as ReturnType<typeof vi.fn>).mock.calls.length;

    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('re-reads the plan once the timer comes round', async () => {
        const { director, lineups, seed } = build();
        await seed();
        await director.start();
        const before = loadCount(lineups);

        director.invalidate();
        await vi.advanceTimersByTimeAsync(1100);

        expect(loadCount(lineups)).toBeGreaterThan(before);
    });

    // The case that used to leave the station stuck: the row said start from the top, and the
    // reactor carried on from where it was because nothing ever made it look again.
    it('picks up a cursor moved underneath it', async () => {
        const { director, setAir, seed } = build();
        await seed();
        await director.start();
        expect(director.status().cursor).toBe(3);

        // What putOnAir writes: same lineup, back to the top. The id is unchanged, which is
        // precisely why the reactor used to ignore it.
        setAir({ slot: 'main', lineupId: 'lineup-1', cursor: 0, active: true });
        director.invalidate();
        await vi.advanceTimersByTimeAsync(1100);

        expect(director.status().cursor).toBe(0);
    });

    // A pass fired inside the request must not consume the flag: at that moment the write it is
    // about to read has not committed.
    it('does not re-read on a rundown event, only on the timer', async () => {
        const { director, lineups, rundown, seed } = build();
        await seed();
        await director.start();
        const before = loadCount(lineups);

        director.invalidate();
        await rundown.next();
        await Promise.resolve();

        expect(loadCount(lineups)).toBe(before);
    });

    it('costs nothing while nothing has changed', async () => {
        const { director, lineups, seed } = build();
        await seed();
        await director.start();
        const before = loadCount(lineups);

        await vi.advanceTimersByTimeAsync(5000);

        expect(loadCount(lineups)).toBe(before);
    });

    it('coalesces several changes into one re-read', async () => {
        const { director, lineups, seed } = build();
        await seed();
        await director.start();
        const before = loadCount(lineups);

        director.invalidate();
        director.invalidate();
        director.invalidate();
        await vi.advanceTimersByTimeAsync(1100);

        expect(loadCount(lineups)).toBe(before + 1);
    });

    it('stops looking once it has been stopped', async () => {
        const { director, lineups, seed } = build();
        await seed();
        await director.start();
        director.stop();
        const before = loadCount(lineups);

        director.invalidate();
        await vi.advanceTimersByTimeAsync(5000);

        expect(loadCount(lineups)).toBe(before);
    });
});

// The guard that makes the flag more than a hint. A pass running while the plan is known to be
// wrong would commit from the copy it is holding AND write the cursor it reached — on its own
// connection, landing after the request that just reset that cursor. The reset would be undone by
// the reactor moments after it was made, which is exactly what "put this lineup on air" hit.
describe('DirectorService while it knows the plan is wrong', () => {
    it('commits nothing until it has re-read', async () => {
        const { director, rundown, lineup, seed } = build();
        await seed();
        await director.start();
        const cursorWhenInvalidated = lineup.cursor();

        director.invalidate();
        // Drain what the player is holding, which is the loudest possible reason to commit more.
        await rundown.next();
        await rundown.next();
        await settle();

        expect(lineup.cursor()).toBe(cursorWhenInvalidated);
    });

    it('starts committing again once the re-read has happened', async () => {
        vi.useFakeTimers();
        try {
            const { director, rundown, lineup, seed } = build();
            await seed();
            await director.start();

            director.invalidate();
            await vi.advanceTimersByTimeAsync(1100);
            // Re-read, so back to the top of the order the air row names.
            expect(lineup.cursor()).toBe(0);

            // Empty what the player is holding, which is the one thing that makes the reactor
            // commit again. Before the re-read this would have done nothing at all.
            rundown.load([]);
            await vi.advanceTimersByTimeAsync(10);

            expect(lineup.cursor()).toBe(3);
        } finally {
            vi.useRealTimers();
        }
    });
});

// The refill is the only thing standing between a rotation and silence, and both ways it used to
// fail were invisible: the send threw where nobody was waiting, and the guard that stops a burst of
// duplicate sends latched anyway, so it never tried again.
describe('DirectorService asking for a refill', () => {
    it('sends the refill from a scope of its own', async () => {
        const { director, jobs, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();

        await director.start();
        await settle();

        expect(jobs.send).toHaveBeenCalledWith('director.extend_lineup', { lineupId: 'lineup-1' });
    });

    // The one that turned a transient failure into a permanent one.
    it('asks again after a send that failed', async () => {
        const { director, rundown, jobs, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();
        jobs.send.mockRejectedValueOnce(new Error('the broker is not available here'));

        await director.start();
        await settle();
        await wake(rundown);

        // Before the fix the guard was set before the send, so the one that threw latched it and
        // the station never asked again. Now the guard is only set once a send has landed, so a
        // failure is retried on the next pass.
        expect(jobs.send.mock.calls.length).toBeGreaterThan(1);
    });

    it('does not ask twice for the same shortfall once a send has landed', async () => {
        const { director, rundown, jobs, seed } = build({ items: ['a', 'b', 'c'] });
        await seed();
        await director.start();
        await settle();

        await wake(rundown);
        await wake(rundown);

        expect(jobs.send).toHaveBeenCalledTimes(1);
    });
});

describe('DirectorService opening a database scope', () => {
    // The repositories are scoped and this class is a singleton, so every read
    // below opens a scope of its own and closes it again. It opens them from the
    // container it was injected with, which is the ROOT: InjectKit resolves a
    // singleton's dependencies from the root rather than from whichever scope
    // built it, and two of this class's dependents are resolved per scope
    // (`ExtendLineupJob` from the job runner's, `DirectorConsoleService` from a
    // request's). Before that rule, a race decided whether these scopes were the
    // children of a container that had already been disposed, and it logged
    // `Transaction is already committed` on roughly a third of boots.
    it('opens a scope per unit of work and disposes it', async () => {
        const { director, createScope, scope, seed } = build({ items: ['a'] });
        await seed();

        await director.start();
        // `start` ends in a restore whose commit pass leaves work in flight; a scope
        // still open here is one the assertion below would blame for leaking.
        await settle();

        expect(createScope).toHaveBeenCalled();
        expect(scope.disposeAsync).toHaveBeenCalledTimes(createScope.mock.calls.length);
    });
});
