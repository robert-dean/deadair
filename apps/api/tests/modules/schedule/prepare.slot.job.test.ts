// A show that is only a brief used to open with an empty running order and stay silent until a model
// refill came back. This job is what chooses its opening records before it starts, and nearly every
// case here is one of the ordinary ways it declines, each of which leaves the show to open as it did
// before the job existed.

import { describe, expect, it, vi } from 'vitest';
import { Duration } from 'luxon';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { JobContext } from '@maroonedsoftware/jobbroker';

import { PrepareSlotJob, type PrepareSlotPayload } from '../../../src/modules/schedule/prepare.slot.job.js';
import type { PreparedSetRepository } from '../../../src/modules/schedule/prepared.set.repository.js';
import type { ScheduleRepository } from '../../../src/modules/schedule/schedule.repository.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';
import type { PickResolver } from '../../../src/modules/director/pick.resolver.js';
import type { SetGenerator, SetInputs, TrackPick } from '../../../src/modules/director/set.generator.js';
import { StationLineup } from '../../../src/modules/director/station.lineup.js';
import type { StationLineupRepository } from '../../../src/modules/director/station.lineup.repository.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import type { StationEvent } from '../../../src/modules/activity/station.events.repository.js';
import type { TrackCachePlanner } from '../../../src/modules/playout/audio/track.cache.planner.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const track = (title: string, artist: string): RundownTrack => ({ pluginId: 'deadair.spotify', externalId: title, title, artists: [artist], artist });

const glam: ScheduleSlot = {
    id: 'glam',
    label: 'Glam Slam',
    startsAtMinutes: 1020,
    endsAtMinutes: 1140,
    days: [],
    brief: 'glam rock',
    era: { from: 1970, to: 1979 },
    mode: 'rotation',
    onEnd: 'extend',
};

const tonight: PrepareSlotPayload = { slotId: 'glam', occurrence: '2026-10-09' };

interface Options {
    slot?: ScheduleSlot;
    /** What is already prepared for tonight. */
    existing?: RundownTrack[];
    /** The order on air now. Absent is a station holding none. */
    lineup?: StationLineup;
    /** What fetching the opening's audio does. Defaults to asking for one record. */
    warm?: (tracks: readonly RundownTrack[]) => Promise<number>;
    /** What the resolver keeps. Defaults to everything named. */
    resolvable?: (picks: readonly TrackPick[]) => RundownTrack[];
    /** The limit pg-boss reports for the run. Absent is a backend that reports none. */
    expiresIn?: Duration;
}

function build(options: Options = {}) {
    const slots = { list: vi.fn(async () => (options.slot === undefined ? [glam] : [options.slot])) } as unknown as ScheduleRepository;
    const prepared = {
        forNight: vi.fn(async () => options.existing),
        save: vi.fn(async (_slotId: string, _occurrence: string, _tracks: readonly RundownTrack[]) => undefined),
    };
    const order = { load: vi.fn(async () => options.lineup) } as unknown as StationLineupRepository;

    const named = Array.from({ length: 30 }, (_, index) => ({ title: `T${index}`, artist: `Artist${index}` }));
    const generate = vi.fn(async (_inputs: SetInputs) => named);
    const resolver = {
        resolve: vi.fn(async (picks: readonly TrackPick[]) =>
            options.resolvable ? options.resolvable(picks) : picks.map(pick => track(pick.title, pick.artist)),
        ),
    } as unknown as PickResolver;

    const cache = { warm: vi.fn(options.warm ?? (async () => 1)) };

    const recorded: StationEvent[] = [];
    const activity = { record: vi.fn(async (event: StationEvent) => void recorded.push(event)) } as unknown as ActivityRecorder;

    const job = new PrepareSlotJob(
        slots,
        prepared as unknown as PreparedSetRepository,
        order,
        { generate } as unknown as SetGenerator,
        resolver,
        cache as unknown as TrackCachePlanner,
        activity,
        settingsConfig({}).config,
        (options.expiresIn === undefined ? {} : { expiresIn: options.expiresIn }) as JobContext,
        {} as Container,
        logger,
    );

    return {
        run: (payload: PrepareSlotPayload = tonight, signal?: AbortSignal) =>
            (job as unknown as { execute(payload: PrepareSlotPayload, signal?: AbortSignal): Promise<void> }).execute(payload, signal),
        prepared,
        cache,
        generate,
        recorded: () => recorded,
    };
}

describe('PrepareSlotJob', () => {
    it("chooses the show's opening records from its own brief and period, and keeps them for tonight", async () => {
        const { run, prepared, generate, recorded } = build();

        await run();

        expect(generate).toHaveBeenCalledWith(
            expect.objectContaining({ brief: 'glam rock', era: { from: 1970, to: 1979 }, broadcast: { mode: 'rotation', slotId: 'glam' } }),
        );
        expect(prepared.save).toHaveBeenCalledWith('glam', '2026-10-09', expect.any(Array));
        expect(prepared.save.mock.calls[0]?.[2].length).toBeGreaterThan(0);
        expect(recorded()).toEqual([expect.objectContaining({ kind: 'schedule.prepared', data: expect.objectContaining({ slot: 'glam' }) })]);
    });

    it('fetches the audio of the records it chose, since the show cannot open on a record still downloading', async () => {
        const { run, prepared, cache } = build();

        await run();

        expect(cache.warm).toHaveBeenCalledWith(prepared.save.mock.calls[0]?.[2]);
    });

    it('keeps the set when the audio cannot be asked for, which the boundary asks for as before', async () => {
        const { run, prepared, recorded } = build({
            warm: async () => {
                throw new Error('queue down');
            },
        });

        await expect(run()).resolves.toBeUndefined();
        expect(prepared.save).toHaveBeenCalled();
        expect(recorded()).toEqual([expect.objectContaining({ kind: 'schedule.prepared' })]);
    });

    it('keeps the next show from opening on a record the station is about to play', async () => {
        const lineup = new StationLineup({ name: 'Evening', mode: 'rotation', onEnd: 'extend', source: 'director' });
        lineup.append([track('Rebel Rebel', 'David Bowie')]);
        const { run, generate } = build({ lineup });

        await run();

        expect([...(generate.mock.calls[0]?.[0].avoidSongKeys ?? [])]).toHaveLength(1);
    });

    it('does nothing once tonight is prepared, which is what makes the repeat sends cheap', async () => {
        const { run, generate, prepared } = build({ existing: [track('Rebel Rebel', 'David Bowie')] });

        await run();

        expect(generate).not.toHaveBeenCalled();
        expect(prepared.save).not.toHaveBeenCalled();
    });

    it('does nothing for a slot that has been given a source since', async () => {
        const { run, generate } = build({ slot: { ...glam, source: { pluginId: 'deadair.spotify', playlistId: 'pl_1' } } });

        await run();

        expect(generate).not.toHaveBeenCalled();
    });

    it('does nothing for a slot that has gone', async () => {
        const { run, generate } = build();

        await run({ slotId: 'deleted', occurrence: '2026-10-09' });

        expect(generate).not.toHaveBeenCalled();
    });

    it('does nothing once the night has started without one', async () => {
        // A set saved now would be for a night already on air, and nothing would ever read it.
        const lineup = new StationLineup({
            name: 'Glam Slam',
            mode: 'rotation',
            onEnd: 'extend',
            source: 'director',
            slotId: 'glam',
            slotOccurrence: '2026-10-09',
        });
        const { run, generate } = build({ lineup });

        await run();

        expect(generate).not.toHaveBeenCalled();
    });

    // A person put the show on air by hand inside its own block: the order carries the slot and no
    // night, and the tick never changes an order like that over at a night boundary, so a set saved
    // now would never be read whichever night it was for.
    it('does nothing while the show is on air by hand', async () => {
        const lineup = new StationLineup({
            name: 'Glam Slam',
            mode: 'rotation',
            onEnd: 'extend',
            source: 'director',
            slotId: 'glam',
        });
        const { run, generate } = build({ lineup });

        await run();

        expect(generate).not.toHaveBeenCalled();
    });

    it('still prepares the next show while a different one is on air by hand', async () => {
        const lineup = new StationLineup({
            name: 'Something else',
            mode: 'rotation',
            onEnd: 'extend',
            source: 'director',
            slotId: 'not-glam',
        });
        const { run, generate } = build({ lineup });

        await run();

        expect(generate).toHaveBeenCalled();
    });

    // This return used to be silent, so a show that opened empty gave no hint its opening had been
    // chosen and thrown away. Logged rather than put on the feed, as an empty answer is.
    it('says so in the log when it runs past its time limit, and saves nothing', async () => {
        const stop = new AbortController();
        const { run, generate, prepared } = build({ expiresIn: Duration.fromMillis(0) });
        generate.mockImplementationOnce(async () => {
            stop.abort();
            return [{ title: 'Rebel Rebel', artist: 'David Bowie' }];
        });

        await run(tonight, stop.signal);

        expect(prepared.save).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            'schedule: preparing the next show ran past its time limit, so it opens without a prepared set',
            expect.objectContaining({ slot: 'glam', named: 1 }),
        );
    });

    it('logs a shutdown as no fault', async () => {
        const stop = new AbortController();
        const { run, generate } = build({ expiresIn: Duration.fromObject({ minutes: 12 }) });
        generate.mockImplementationOnce(async () => {
            stop.abort();
            return [];
        });

        await run(tonight, stop.signal);

        expect(logger.info).toHaveBeenCalledWith('schedule: preparing the next show was stopped by a shutdown', expect.anything());
    });

    it('does nothing for a mode that generates nothing', async () => {
        const { run, generate } = build({ slot: { ...glam, mode: 'setlist' } });

        await run();

        expect(generate).not.toHaveBeenCalled();
    });

    it('writes nothing when nothing survives the rules, so the show refills at its start as before', async () => {
        const { run, prepared, recorded } = build({ resolvable: () => [] });

        await run();

        expect(prepared.save).not.toHaveBeenCalled();
        expect(recorded()).toEqual([]);
    });
});
