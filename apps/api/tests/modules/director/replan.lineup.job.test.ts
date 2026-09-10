// A replan is the refill's shape pointed at a different question: not "what else should the
// station play" but "play something else". Almost everything that can go wrong here is a version of
// taking the tail away before there is anything to put back, because an empty running order is how
// the station loses its mount lease and goes quiet.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { JobContext } from '@maroonedsoftware/jobbroker';

import type { DirectorService } from '../../../src/modules/director/director.service.js';
import { settingsConfig } from '../../utils/settings.config.js';
import { ReplanLineupJob } from '../../../src/modules/director/replan.lineup.job.js';
import { RefillPreemption } from '../../../src/modules/director/refill.preemption.js';
import { StationLineup, type StationLineupMode } from '../../../src/modules/director/station.lineup.js';
import type { StationLineupRepository } from '../../../src/modules/director/station.lineup.repository.js';
import type { DirectorCommand } from '../../../src/modules/director/director.mailbox.js';
import type { PickResolver } from '../../../src/modules/director/pick.resolver.js';
import { artistKey, songKey } from '../../../src/modules/director/rotation.keys.js';
import type { SetGenerator, SetInputs, TrackPick } from '../../../src/modules/director/set.generator.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const context = { id: 'job-1' } as unknown as JobContext;
const container = {} as unknown as Container;

const track = (title: string, artist = 'One'): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId: `ext-${title}`,
    title,
    artists: [artist],
    artist,
});

const titlesOf = (lineup: StationLineup) =>
    lineup.all().flatMap(item => (item.kind === 'track' ? [item.track.title] : [`segment:${item.segmentId}`]));

interface Options {
    /**
     * How many of the planning attempts a break interrupts, marked up front.
     *
     * 1 is the ordinary case this was built for: the first plan is preempted and the second is not.
     * 2 is the station too busy to ever give the refill the model, where the floor's hour is the
     * honest answer.
     */
    preemptedTimes?: number;
    mode?: StationLineupMode;
    brief?: string;
    existing?: RundownTrack[];
    picks?: TrackPick[];
    resolvable?: (picks: readonly TrackPick[]) => RundownTrack[];
    missing?: boolean;
}

function build(options: Options = {}) {
    const station = settingsConfig({});
    const lineup = new StationLineup({
        name: 'Afternoons',
        mode: options.mode ?? 'rotation',
        onEnd: 'extend',
        source: 'director',
        ...(options.brief === undefined ? {} : { brief: options.brief }),
    });

    const lineups = {
        load: vi.fn(async () => (options.missing ? undefined : lineup)),
    } as unknown as StationLineupRepository;

    const named = options.picks ?? Array.from({ length: 20 }, (_, index) => ({ title: `Fresh${index}`, artist: `Artist${index}` }));
    const generate = vi.fn(async (_inputs: SetInputs) => named);
    const generator = { generate } as unknown as SetGenerator;

    // Declared with all three of `PickResolver.resolve`'s parameters even though the body reads
    // only the first: the options argument is what one case below asserts on, and a double that
    // takes fewer arguments than the real method types that read as an out-of-range index.
    const resolve = vi.fn(
        async (picks: readonly TrackPick[], _rules?: unknown, _options?: { avoidArtistKeys?: ReadonlySet<string>; seedArtistKey?: string }) =>
            options.resolvable ? options.resolvable(picks) : picks.map(pick => track(pick.title, pick.artist)),
    );
    const resolver = { resolve } as unknown as PickResolver;

    // The one writer, applying the command the way the real director does, so the assertions below
    // are about the running order rather than about a mock call.
    const posted: DirectorCommand[] = [];
    const director = {
        invalidate: vi.fn(),
        post: vi.fn(async (command: DirectorCommand) => {
            posted.push(command);
            if (command.kind === 'replaceTail') lineup.replacePlanned(command.tracks);
            return undefined;
        }),
    } as unknown as DirectorService;

    // A refill nothing interrupted, which is every case here but the one that says otherwise:
    // `took` answers false and the plan runs exactly once.
    const preemption = new RefillPreemption();
    if (options.preemptedTimes) for (let i = 0; i < options.preemptedTimes; i++) preemption.mark();

    return {
        job: new ReplanLineupJob(lineups, generator, resolver, preemption, director, station.config, context, container, logger),
        director,
        posted: () => posted,
        preemption,
        lineup,
        seed: async () => (options.existing ? lineup.append(options.existing) : undefined),
        generate,
        resolve,
    };
}

describe('ReplanLineupJob', () => {
    it('puts the fresh records where everything planned was', async () => {
        const { job, seed, lineup } = build({ existing: [track('Old A'), track('Old B')] });
        await seed();

        await job.run({ count: 2 });

        expect(titlesOf(lineup)).toEqual(['Fresh0', 'Fresh1']);
    });

    it('tells the generator not to choose the records it is about to throw away', async () => {
        // The whole difference between this and a shuffle. `play_history` only knows what AIRED,
        // and none of the discarded tail has, so without these keys the generator can hand most of
        // it straight back and the operator gets the same hour in a different order.
        const { job, seed, generate } = build({ existing: [track('Tired Of This')] });
        await seed();

        await job.run({ count: 2 });

        expect(generate.mock.calls[0]![0]!.avoidSongKeys).toContain(songKey('Tired Of This', ['One']));
    });

    it('spaces the new tail against the record that survives the replan, not the one it discards', async () => {
        // The seam a replan leaves is NOT the seam a refill leaves, and reading it the same way was
        // wrong in the one direction that matters. `replacePlanned` keeps what is not `planned` and
        // appends after it, so the new batch lands beside the last HANDED record — while
        // `upcoming()`'s tail is the planned records about to be thrown away. Seeding off those
        // spaces the batch against records nobody will ever hear and leaves the actual join
        // uncompared, which is how the same artist ends up on both sides of it.
        const { job, seed, lineup, resolve } = build({ existing: [track('Stays', 'Survivor'), track('Goes', 'Discarded')] });
        await seed();
        lineup.markHanded(lineup.all()[0]!.id);

        await job.run({ count: 2 });

        const options = resolve.mock.calls[0]![2]!;
        expect(options.seedArtistKey).toBe(artistKey(['Survivor']));
        expect(options.avoidArtistKeys).toContain(artistKey(['Survivor']));
        expect(options.avoidArtistKeys).not.toContain(artistKey(['Discarded']));
    });

    it('programmes against the brief the broadcast is already carrying', async () => {
        const { job, generate } = build({ brief: 'heavy metal hits' });

        await job.run({ count: 2 });

        expect(generate.mock.calls[0]![0]!.brief).toBe('heavy metal hits');
    });

    it('tells the generator nothing about who is presenting', async () => {
        // As `ExtendLineupJob`: a persona is a voice and says nothing about what the station plays,
        // so a replan is steered by the brief on the running order alone.
        const { job, generate } = build();

        await job.run();

        expect(generate.mock.calls[0]?.[0]).not.toHaveProperty('persona');
    });

    it('asks for more names than it needs, because most of a batch is discarded', async () => {
        const { job, generate } = build();

        await job.run({ count: 10 });

        expect(generate.mock.calls[0]![0]!.count).toBeGreaterThan(10);
    });

    it('hands back no more than was asked for', async () => {
        const { job, lineup } = build();

        await job.run({ count: 5 });

        expect(lineup.size()).toBe(5);
    });

    it('generates BEFORE anything is dropped, so the old tail plays until there is a replacement', async () => {
        // The load-bearing property. Empty the order first and `hasProgramme()` goes false, the
        // mount lease stops being renewed, and the station is off air inside a few seconds while
        // the model is still choosing.
        const { job, seed, lineup, generate } = build({ existing: [track('Still Playing')] });
        await seed();

        let heldDuring: string[] = [];
        generate.mockImplementationOnce(async () => {
            heldDuring = titlesOf(lineup);
            return [{ title: 'Fresh0', artist: 'A' }];
        });

        await job.run({ count: 1 });

        expect(heldDuring).toEqual(['Still Playing']);
    });

    it('leaves the running order alone when it could not find a single record', async () => {
        // Posting an empty replacement would empty the order, which is the one outcome this job's
        // whole shape exists to avoid. Better a tired hour than a silent one.
        const { job, seed, lineup, director } = build({ existing: [track('Old A')], resolvable: () => [] });
        await seed();

        await job.run({ count: 5 });

        expect(director.post).not.toHaveBeenCalled();
        expect(titlesOf(lineup)).toEqual(['Old A']);
    });

    it('cancels whatever the director was about to do before it posts', async () => {
        // A commit pass may have gathered its material already and be suspended in a database read.
        // Only the epoch reaches it; a command runs after it, by which time the stale decision has
        // been applied.
        const { job, director } = build();

        await job.run({ count: 2 });

        expect(director.invalidate).toHaveBeenCalledBefore(vi.mocked(director.post));
    });

    it('refuses to replan a setlist, which nothing could fill back up', async () => {
        // Worse here than for a refill: this one takes something away first, so replacing a
        // curated list with nothing generates into it would leave an order that stays empty.
        const { job, seed, lineup, generate } = build({ mode: 'setlist', existing: [track('Carol')] });
        await seed();

        await job.run({ count: 5 });

        expect(generate).not.toHaveBeenCalled();
        expect(titlesOf(lineup)).toEqual(['Carol']);
    });

    it('refuses to replan a feature', async () => {
        const { job, generate } = build({ mode: 'feature' });

        await job.run({ count: 5 });

        expect(generate).not.toHaveBeenCalled();
    });

    it('shrugs when the station has nothing on air to replan', async () => {
        const { job, director, generate } = build({ missing: true });

        await expect(job.run({})).resolves.toBeUndefined();
        expect(generate).not.toHaveBeenCalled();
        expect(director.post).not.toHaveBeenCalled();
    });

    it('drops nothing when the run is cancelled before it posts', async () => {
        const { job, seed, lineup, director } = build({ existing: [track('Old A')] });
        await seed();

        await job.run({ count: 5 }, AbortSignal.abort());

        expect(director.post).not.toHaveBeenCalled();
        expect(titlesOf(lineup)).toEqual(['Old A']);
    });

    it('fails the job when the swap fails, so its retry is a real one', async () => {
        const { job, director } = build();
        vi.mocked(director.post).mockRejectedValueOnce(new Error('the database is gone'));

        await expect(job.run({ count: 3 })).rejects.toThrow('the database is gone');
    });
});

// A replan is generated against the broadcast this job loaded minutes earlier, and the director may
// have moved on to a new one by the time this posts. `broadcastId` is what lets the director tell
// the two apart, and what lets this job refuse to pay for the model at all once it already knows
// the ask is stale.
describe('ReplanLineupJob stamping the command it posts', () => {
    it('posts the command carrying the broadcast it actually loaded', async () => {
        const { job, seed, lineup, posted } = build({ existing: [track('Old A')] });
        await seed();

        await job.run({ count: 2 });

        const [command] = posted();
        expect(command).toMatchObject({ kind: 'replaceTail', broadcastId: lineup.broadcastId });
    });

    it('skips generating when the payload names a broadcast the loaded lineup is not', async () => {
        const { job, generate, director } = build();

        await job.run({ count: 2, broadcastId: 'a-broadcast-that-has-ended' });

        expect(generate).not.toHaveBeenCalled();
        expect(director.post).not.toHaveBeenCalled();
    });

    it('generates when the payload names no particular broadcast', async () => {
        const { job, generate } = build();

        await job.run({ count: 2 });

        expect(generate).toHaveBeenCalled();
    });

    it('generates when the payload names the broadcast the loaded lineup is', async () => {
        const { job, generate, lineup } = build();

        await job.run({ count: 2, broadcastId: lineup.broadcastId });

        expect(generate).toHaveBeenCalled();
    });
});
