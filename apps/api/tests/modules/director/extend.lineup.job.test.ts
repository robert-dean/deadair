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
import { RefillPreemption } from '../../../src/modules/director/refill.preemption.js';
import { StationLineup, type StationLineupMode } from '../../../src/modules/director/station.lineup.js';
import type { StationLineupRepository } from '../../../src/modules/director/station.lineup.repository.js';
import type { DirectorCommand } from '../../../src/modules/director/director.mailbox.js';
import type { PickResolver } from '../../../src/modules/director/pick.resolver.js';
import { songKey } from '../../../src/modules/director/rotation.keys.js';
import type { Persona } from '../../../src/modules/personas/persona.js';
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

/** The record at one position, failing loudly rather than narrowing to undefined if a segment is there. */
const trackAt = (lineup: StationLineup, index: number): RundownTrack => {
    const item = lineup.all()[index];
    if (item?.kind !== 'track') throw new Error(`expected a record at ${index}, found ${item?.kind ?? 'nothing'}`);
    return item.track;
};

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
    /** What the operator asked this broadcast to play. Absent is a station programming itself. */
    brief?: string;
    existing?: RundownTrack[];
    /** What the generator names. Defaults to twenty tracks, more than any ask here. */
    picks?: TrackPick[];
    /** What the resolver can actually play, by title. Defaults to everything named. */
    resolvable?: (picks: readonly TrackPick[]) => RundownTrack[];
    missing?: boolean;
    /** The persona on air, for the one test about handing it to the generator. */
    persona?: Persona;
}

function build(options: Options & { stationRules?: Record<string, string> } = {}) {
    // The station's own rotation rules, as an operator has them set. Empty means every default.
    const station = settingsConfig(options.stationRules ?? {});
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

    const named = options.picks ?? Array.from({ length: 20 }, (_, index) => ({ title: `T${index}`, artist: `Artist${index}` }));
    const generate = vi.fn(async (_inputs: SetInputs) => named);
    const generator = { generate } as unknown as SetGenerator;

    const resolve = vi.fn(async (picks: readonly TrackPick[]) =>
        options.resolvable ? options.resolvable(picks) : picks.map(pick => track(pick.title, pick.artist)),
    );
    const resolver = { resolve } as unknown as PickResolver;

    // The one writer. This job hands finished records over rather than appending them itself, so
    // the fake applies the command the way the real director does: that is what keeps the
    // assertions below about the lineup rather than about a mock call.
    const posted: DirectorCommand[] = [];
    const director = {
        invalidate: vi.fn(),
        post: vi.fn(async (command: DirectorCommand) => {
            posted.push(command);
            if (command.kind === 'appendTracks') lineup.append(command.tracks);
            return undefined;
        }),
    } as unknown as DirectorService;

    // Who the station is right now. `undefined` unless a test asks otherwise: a station that has
    // chosen no persona programmes exactly as it did before personas existed.
    const personas = { presenting: vi.fn(async () => options.persona) } as never;

    // A refill nothing interrupted, which is every case here but the one that says otherwise:
    // `took` answers false and the plan runs exactly once.
    const preemption = new RefillPreemption();
    if (options.preemptedTimes) for (let i = 0; i < options.preemptedTimes; i++) preemption.mark();

    return {
        job: new ExtendLineupJob(lineups, generator, resolver, personas, preemption, director, station.config, context, container, logger),
        director,
        posted: () => posted,
        preemption,
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

        await job.run({ count: 5 });

        expect(lineup.size()).toBe(5);
    });

    it('asks for more names than it needs, because most of a batch is discarded', async () => {
        const { job, generate } = build();

        await job.run({ count: 10 });

        expect(generate.mock.calls[0]![0]!.count).toBeGreaterThan(10);
    });

    it('passes the operator’s brief on every refill, not just the first', async () => {
        // The brief lives on the running order rather than in this job's payload precisely so that
        // it survives to the next refill an hour later. Two runs, both briefed.
        const { job, generate } = build({ brief: 'heavy metal hits' });

        await job.run({ count: 5 });
        await job.run({ count: 5 });

        expect(generate.mock.calls[0]![0]!.brief).toBe('heavy metal hits');
        expect(generate.mock.calls[1]![0]!.brief).toBe('heavy metal hits');
    });

    it('passes the persona on air, so choosing one steers what plays as well as what is said', async () => {
        const persona = {
            id: 'p-1',
            key: 'pirate',
            label: 'Pirate captain',
            style: 'a pirate captain',
            music: 'Loud and rowdy',
            active: true,
        } as Persona;
        const { job, generate } = build({ persona });

        await job.run();

        expect(generate.mock.calls[0]?.[0]).toMatchObject({ persona });
    });

    it('says nothing about a persona when the station has chosen none', async () => {
        const { job, generate } = build();

        await job.run();

        expect(generate.mock.calls[0]?.[0]).not.toHaveProperty('persona');
    });

    it('says nothing about a brief when the station was never given one', async () => {
        const { job, generate } = build();

        await job.run({ count: 5 });

        expect(generate.mock.calls[0]![0]!.brief).toBeUndefined();
    });

    it('tells the generator what the lineup already holds', async () => {
        // History only knows what AIRED. A track queued ten minutes ago is invisible
        // to it, and choosing it again would put it in the lineup twice.
        const { job, seed, generate } = build({ existing: [track('Already Here')] });
        await seed();

        await job.run({ count: 1 });

        expect(generate.mock.calls[0]![0]!.avoidSongKeys).toContain(songKey('Already Here', ['One']));
    });

    it('keys a collaboration by its lead, not by the credit line the item displays', async () => {
        // The item shows "Drake, Wizkid, Kyla" and is one artist named Drake. Keying the credit
        // put a three-act string in the key space, where it could never match `play_history` or a
        // pick — so the record the station had just queued was offered back to the generator, and
        // no repeat window or artist cooldown could see a collaboration at all.
        const collaboration: RundownTrack = {
            pluginId: 'deadair.spotify',
            externalId: 'ext-One Dance',
            title: 'One Dance',
            artists: ['Drake, Wizkid, Kyla'],
            artist: 'Drake',
        };
        const { job, seed, generate } = build({ existing: [collaboration] });
        await seed();

        await job.run({ count: 1 });

        expect(generate.mock.calls[0]![0]!.avoidSongKeys).toContain(songKey('One Dance', ['Drake']));
    });

    it('does not exclude artists already in the lineup', async () => {
        // Excluding them would starve a long rotation of its own library: a hundred
        // tracks is sixty artists, and after two refills there is nobody left.
        const { job, seed, generate } = build({ existing: [track('A', 'One')] });
        await seed();

        await job.run({ count: 1 });

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

        await job.run({ count: 2 });

        expect(lineup.all().flatMap(item => (item.kind === 'track' ? [item.track.title] : []))).toEqual(['Playable']);
    });

    it('refuses to generate into a setlist', async () => {
        // A Christmas list is finite and curated on purpose. Anything that asked is
        // reporting a bug upstream rather than making a request.
        const { job, lineup, generate } = build({ mode: 'setlist' });

        await job.run({ count: 5 });

        expect(generate).not.toHaveBeenCalled();
        expect(lineup.isEmpty()).toBe(true);
    });

    it('refuses to generate into a feature', async () => {
        const { job, generate } = build({ mode: 'feature' });

        await job.run({ count: 5 });

        expect(generate).not.toHaveBeenCalled();
    });

    it('shrugs at a lineup that was deleted between the send and the run', async () => {
        const { job, generate } = build({ missing: true });

        await expect(job.run({})).resolves.toBeUndefined();
        expect(generate).not.toHaveBeenCalled();
    });

    it('shrugs when the station has nothing on air to extend', async () => {
        // An ordinary race with a stand-down rather than a fault: the job was sent while there
        // was a running order and ran after it went away.
        const { job, director } = build({ missing: true });

        await expect(job.run({})).resolves.toBeUndefined();
        await expect(job.run()).resolves.toBeUndefined();
        expect(director.post).not.toHaveBeenCalled();
    });

    it('stops when the run is cancelled before it writes', async () => {
        const { job, lineup } = build();

        await job.run({ count: 5 }, AbortSignal.abort());

        expect(lineup.isEmpty()).toBe(true);
    });

    it('appends rather than replacing, so a retry cannot lose what it added', async () => {
        const { job, seed, lineup } = build({ existing: [track('Kept')] });
        await seed();

        await job.run({ count: 2 });

        expect(trackAt(lineup, 0).title).toBe('Kept');
        expect(lineup.size()).toBe(3);
    });
});

// Bug 3, and the reason this job stopped writing. It used to load its own `Lineup`, spend seconds
// generating, and append through a store guarded on the revision moving. The break planner writes
// through that same guard from the director's pass, so whichever landed second was discarded in
// silence while the job logged the tracks it had just lost as `added`.
describe('ExtendLineupJob not writing the lineup itself', () => {
    it('hands the records to the one owner rather than appending them', async () => {
        const { job, director, posted } = build();

        await job.run({ count: 3 });

        expect(director.post).toHaveBeenCalledOnce();
        const [command] = posted();
        expect(command?.kind).toBe('appendTracks');
        // No running order is named, because there is only one and the director owns it.
        expect(command).not.toHaveProperty('lineupId');
    });

    it('cannot lose a refill to a writer that got there first', async () => {
        // The store's guard matches only while the stored revision is older than the one being
        // written, so a second writer landing during the generate above used to make this append a
        // no-op that reported success. There is one writer now, so the refill cannot be dropped
        // whatever else happened while it was being generated.
        const { job, lineup, posted } = build();

        await job.run({ count: 4 });

        const [command] = posted();
        const handed = command?.kind === 'appendTracks' ? command.tracks.length : 0;
        expect(handed).toBe(4);
        // What was handed over is what is in the lineup: no silent gap between the two.
        expect(lineup.size()).toBe(handed);
    });

    it('fails the job when the append fails, rather than logging tracks nobody stored', async () => {
        // The old shape could not tell: a discarded write and a successful one looked identical
        // from here. Awaiting the command makes a failure this job's failure, so its retry is real.
        const { job, director } = build();
        vi.mocked(director.post).mockRejectedValueOnce(new Error('the database is gone'));

        await expect(job.run({ count: 3 })).rejects.toThrow('the database is gone');
    });

    it('plans again when a break took the model off the first attempt', async () => {
        // The model runs as `background` so a break can take it back, which is the design working.
        // What was wrong is where the cost landed: the model was cut off, the chain topped the batch
        // up from a floor that cannot read a brief, and the operator got ordinary rotation with
        // nothing saying why. Nobody is waiting on a refill, so it simply asks again.
        const { job, generate, resolve } = build({ preemptedTimes: 1 });

        await job.run({ count: 4 });

        expect(generate).toHaveBeenCalledTimes(2);
        // Once, after the LAST attempt. A discarded batch must not spend the resolver's discovery
        // budget or ingest records nothing will ever play.
        expect(resolve).toHaveBeenCalledTimes(1);
    });

    it('keeps the second answer rather than topping the first one up', async () => {
        // Planned from scratch, because the floor's picks were chosen to fill a hole the model was
        // going to fill properly: keeping them would leave the batch shaped by the interruption.
        const { job, posted } = build({ preemptedTimes: 1 });

        await job.run({ count: 4 });

        const [command] = posted();
        expect(command?.kind === 'appendTracks' ? command.tracks.length : 0).toBe(4);
    });

    it('gives up after one retry, so a busy hour cannot loop', async () => {
        // A station taking a break every few records can preempt the retry too. At that point the
        // floor's hour is the honest outcome -- the model is genuinely oversubscribed, and the fix
        // for that is not more attempts.
        const { job, generate } = build({ preemptedTimes: 2 });

        await job.run({ count: 4 });

        expect(generate).toHaveBeenCalledTimes(2);
    });

    it('plans once when nothing interrupted it', async () => {
        const { job, generate } = build();

        await job.run({ count: 4 });

        expect(generate).toHaveBeenCalledTimes(1);
    });
});
