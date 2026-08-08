// The reactor is the one thing here with a listener on the other end. What is
// tested is mostly restraint: it commits a few items and no more, it does not
// put a stood-down station back on air, and it does not queue a refill per
// rundown event. The stand-down case is the load-bearing one — an app that kept
// committing after Stop would have the station broadcasting a second after the
// operator stopped it.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { PgBossJobBroker } from '@maroonedsoftware/jobbroker/pgboss';

import { DirectorService } from '../../../src/modules/director/director.service.js';
import { Lineup, type LineupMode, type LineupOnEnd } from '../../../src/modules/director/lineup.js';
import { LineupRepository } from '../../../src/modules/director/lineup.repository.js';
import { PlayHistoryRepository } from '../../../src/modules/director/play.history.repository.js';
import { StationAirRepository, type StationAir } from '../../../src/modules/director/station.air.repository.js';
import { SettingsRepository } from '../../../src/modules/settings/settings.repository.js';
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
        load: vi.fn(async (id: string) => (id === 'lineup-1' ? lineup : id === other?.id ? other : undefined)),
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

    const settings = {
        get: vi.fn(async (key: string) => (key === AIR_MODE_KEY ? options.airMode : undefined)),
    } as unknown as SettingsRepository;

    // Real, over the fake repository: where a break belongs is BreakPlanner's own decision and is
    // tested there, and stubbing it here would leave the wiring — that the reactor plants at all,
    // and does it before committing — untested.
    const breaks = new BreakPlanner(
        {
            listReady: vi.fn(async () => [{ id: 'ident-1', kind: 'ident', state: 'ready', label: 'Ident', source: 'library' }]),
        } as unknown as SegmentRepository,
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
                  : token === SettingsRepository
                    ? settings
                    : token === SegmentRepository
                      ? segments
                      : token === BreakPlanner
                        ? breaks
                        : history,
        ),
        disposeAsync: vi.fn(async () => {}),
    };
    const container = { createScopedContainer: () => scope } as unknown as Container;

    const jobs = { send: vi.fn(async () => 'job-1') } as unknown as PgBossJobBroker;

    // A stub: what the gate does to the mount is PlayoutPusher's, and is tested there.
    // What matters here is only that the mode reaches it.
    const audience = { useMode: vi.fn() } as unknown as AudienceWatch;

    const director = new DirectorService(rundown, audience, container, jobs, logger);

    return {
        director,
        rundown,
        breaks,
        segmentStub,
        lineup,
        other,
        jobs,
        history,
        airRepository,
        settings,
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

    it('publishes the mode to the transport, which is what acts on it', async () => {
        const { director, audience, seed } = build({ airMode: 'always' });
        await seed();

        await director.start();

        expect(audience.useMode).toHaveBeenCalledWith('always');
    });

    it('re-reads the mode with the row, so a change made elsewhere is noticed', async () => {
        // The mode is a setting an operator can change from anywhere, and the console
        // is not the only writer this has to survive. It rides the same throttled read
        // as `station_air` rather than being remembered from boot.
        const { director, settings, seed } = build();
        await seed();
        await director.start();

        vi.mocked(settings.get).mockResolvedValue('always');
        await director.reload();

        expect(director.status().airMode).toBe('always');
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
