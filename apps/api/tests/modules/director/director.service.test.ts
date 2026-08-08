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
import { Rundown, type RundownTrack } from '../../../src/modules/playout/rundown.js';
import { TrackResolver } from '../../../src/modules/playout/playout.capability.js';

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

    const scope = {
        get: vi.fn((token: unknown) =>
            token === LineupRepository ? lineups : token === StationAirRepository ? airRepository : token === SettingsRepository ? settings : history,
        ),
        disposeAsync: vi.fn(async () => {}),
    };
    const container = { createScopedContainer: () => scope } as unknown as Container;

    const jobs = { send: vi.fn(async () => 'job-1') } as unknown as PgBossJobBroker;

    const director = new DirectorService(rundown, container, jobs, logger);

    return {
        director,
        rundown,
        lineup,
        other,
        jobs,
        history,
        airRepository,
        settings,
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
