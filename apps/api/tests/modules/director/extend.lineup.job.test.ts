// The refill is the slow half of the station, run where nobody is waiting on it.
// What matters is that it cannot make the station worse: it must not double-queue
// a track already in the lineup, must not hand back more programming than was
// asked for, and must decline politely for every lineup that is not a rotation
// rather than generating into a Christmas setlist.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import type { Container } from 'injectkit';
import type { JobContext } from '@maroonedsoftware/jobbroker';

import type { BreakPlanner } from '../../../src/modules/director/break.planner.js';
import type { DirectorService } from '../../../src/modules/director/director.service.js';
import { settingsConfig } from '../../utils/settings.config.js';
import { ExtendLineupJob } from '../../../src/modules/director/extend.lineup.job.js';
import { Lineup, type LineupMode } from '../../../src/modules/director/lineup.js';
import type { LineupRepository } from '../../../src/modules/director/lineup.repository.js';
import type { PickResolver } from '../../../src/modules/director/pick.resolver.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';
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
});

interface Options {
    mode?: LineupMode;
    existing?: RundownTrack[];
    /** What the generator names. Defaults to twenty tracks, more than any ask here. */
    picks?: TrackPick[];
    /** What the resolver can actually play, by title. Defaults to everything named. */
    resolvable?: (picks: readonly TrackPick[]) => RundownTrack[];
    missing?: boolean;
}

function build(options: Options & { stationRules?: Record<string, string> } = {}) {
    // The station's own rotation rules, as an operator has them set. Empty means every default.
    const station = settingsConfig(options.stationRules ?? {});
    const lineup = new Lineup({ id: 'lineup-1', name: 'Afternoons', mode: options.mode ?? 'rotation', onEnd: 'extend', source: 'director' });

    const lineups = {
        load: vi.fn(async () => (options.missing ? undefined : lineup)),
    } as unknown as LineupRepository;

    const named = options.picks ?? Array.from({ length: 20 }, (_, index) => ({ title: `T${index}`, artist: `Artist${index}` }));
    const generate = vi.fn(async (_inputs: SetInputs) => named);
    const generator = { generate } as unknown as SetGenerator;

    const resolve = vi.fn(async (picks: readonly TrackPick[]) =>
        options.resolvable ? options.resolvable(picks) : picks.map(pick => track(pick.title, pick.artist)),
    );
    const resolver = { resolve } as unknown as PickResolver;

    // The planner is its own unit and is tested as one. What matters here is that a refill plants
    // breaks among the records it just appended, rather than leaving the director to notice the gap
    // on each of the next several boundaries.
    const breaks = { plant: vi.fn(async () => 0) } as unknown as BreakPlanner;
    // The reactor is holding its own copy of the lineup this job just grew.
    const director = { invalidate: vi.fn() } as unknown as DirectorService;

    return {
        job: new ExtendLineupJob(lineups, generator, resolver, breaks, director, station.config, context, container, logger),
        director,
        breaks,
        lineup,
        station,
        seed: async () => (options.existing ? lineup.append(options.existing) : undefined),
        generate,
        resolve,
        lineups,
    };
}

describe('ExtendLineupJob', () => {
    it('adds what was asked for and no more', async () => {
        // The oversample is headroom against what the rules discard, not a licence to
        // hand back half an hour more programming than the station wanted.
        const { job, lineup } = build();

        await job.run({ lineupId: 'lineup-1', count: 5 });

        expect(lineup.size()).toBe(5);
    });

    it('asks for more names than it needs, because most of a batch is discarded', async () => {
        const { job, generate } = build();

        await job.run({ lineupId: 'lineup-1', count: 10 });

        expect(generate.mock.calls[0]![0]!.count).toBeGreaterThan(10);
    });

    it('tells the generator what the lineup already holds', async () => {
        // History only knows what AIRED. A track queued ten minutes ago is invisible
        // to it, and choosing it again would put it in the lineup twice.
        const { job, seed, generate } = build({ existing: [track('Already Here')] });
        await seed();

        await job.run({ lineupId: 'lineup-1', count: 1 });

        expect(generate.mock.calls[0]![0]!.avoidSongKeys).toContain(songKey('Already Here', ['One']));
    });

    it('does not exclude artists already in the lineup', async () => {
        // Excluding them would starve a long rotation of its own library: a hundred
        // tracks is sixty artists, and after two refills there is nobody left.
        const { job, seed, generate } = build({ existing: [track('A', 'One')] });
        await seed();

        await job.run({ lineupId: 'lineup-1', count: 1 });

        expect(generate.mock.calls[0]![0]!.avoidArtistKeys).toBeUndefined();
    });

    it('adds only what could actually be resolved', async () => {
        const { job, lineup } = build({
            picks: [
                { title: 'Playable', artist: 'One' },
                { title: 'Gone', artist: 'Two' },
            ],
            resolvable: picks => picks.filter(pick => pick.title === 'Playable').map(pick => track(pick.title, pick.artist)),
        });

        await job.run({ lineupId: 'lineup-1', count: 2 });

        expect(lineup.all().map(item => item.track.title)).toEqual(['Playable']);
    });

    it('refuses to generate into a setlist', async () => {
        // A Christmas list is finite and curated on purpose. Anything that asked is
        // reporting a bug upstream rather than making a request.
        const { job, lineup, generate } = build({ mode: 'setlist' });

        await job.run({ lineupId: 'lineup-1', count: 5 });

        expect(generate).not.toHaveBeenCalled();
        expect(lineup.isEmpty()).toBe(true);
    });

    it('refuses to generate into a feature', async () => {
        const { job, generate } = build({ mode: 'feature' });

        await job.run({ lineupId: 'lineup-1', count: 5 });

        expect(generate).not.toHaveBeenCalled();
    });

    it('shrugs at a lineup that was deleted between the send and the run', async () => {
        const { job, generate } = build({ missing: true });

        await expect(job.run({ lineupId: 'lineup-1' })).resolves.toBeUndefined();
        expect(generate).not.toHaveBeenCalled();
    });

    it('shrugs at a payload with nothing to extend', async () => {
        const { job, lineups } = build();

        await expect(job.run({})).resolves.toBeUndefined();
        await expect(job.run()).resolves.toBeUndefined();
        expect(lineups.load).not.toHaveBeenCalled();
    });

    it('stops when the run is cancelled before it writes', async () => {
        const { job, lineup } = build();

        await job.run({ lineupId: 'lineup-1', count: 5 }, AbortSignal.abort());

        expect(lineup.isEmpty()).toBe(true);
    });

    it('appends rather than replacing, so a retry cannot lose what it added', async () => {
        const { job, seed, lineup } = build({ existing: [track('Kept')] });
        await seed();

        await job.run({ lineupId: 'lineup-1', count: 2 });

        expect(lineup.all()[0]!.track.title).toBe('Kept');
        expect(lineup.size()).toBe(3);
    });
});
