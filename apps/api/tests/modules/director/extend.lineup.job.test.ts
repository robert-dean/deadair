// The refill is the slow half of the station, run where nobody is waiting on it.
// What matters is that it cannot make the station worse: it must not double-queue
// a track already in the lineup, must not hand back more programming than was
// asked for, and must decline politely for every lineup that is not a rotation
// rather than generating into a Christmas setlist.

import type { ScheduleService } from '../../../src/modules/schedule/schedule.service.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';
import type { LyricMood } from '../../../src/modules/lyrics/lyric.moods.js';
import { describe, expect, it, vi } from 'vitest';
import { Duration } from 'luxon';
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
import { artistKey, songKey } from '../../../src/modules/director/rotation.keys.js';
import { ROTATION_KEYS } from '../../../src/modules/director/rotation.rules.js';
import type { SetGenerator, SetInputs, TrackPick } from '../../../src/modules/director/set.generator.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';
import type { ActivityRecorder } from '../../../src/modules/activity/activity.recorder.js';
import type { StationEvent } from '../../../src/modules/activity/station.events.repository.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
const context = { id: 'job-1' } as unknown as JobContext;
/** The job's context, carrying the limit pg-boss reports when a case sets one. */
const contextFor = (expiresIn?: Duration): JobContext => ({ ...context, ...(expiresIn === undefined ? {} : { expiresIn }) });
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
     * 2 is the station too busy to ever give the refill the model, where the last attempt answers
     * with whatever its searches found.
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
    /** The limit pg-boss reports for the run. Absent is a backend that reports none. */
    expiresIn?: Duration;
    /** The broadcast's mood stages, and the slot it was put on for. */
    moods?: LyricMood[];
    slotId?: string;
    /** The slot the schedule says is in force. */
    inForce?: ScheduleSlot;
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
        ...(options.moods === undefined ? {} : { moods: options.moods }),
        ...(options.slotId === undefined ? {} : { slotId: options.slotId }),
    });

    const schedule = { inForce: vi.fn(async () => options.inForce) } as unknown as ScheduleService;

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

    // A refill nothing interrupted, which is every case here but the one that says otherwise:
    // `took` answers false and the plan runs exactly once.
    const preemption = new RefillPreemption();
    if (options.preemptedTimes) for (let i = 0; i < options.preemptedTimes; i++) preemption.mark();

    // The feed. Best-effort by contract and `void`ed by its caller, so the double only has to
    // record what it was asked to say — see the empty-refill case below.
    const recorded: StationEvent[] = [];
    const activity = { record: vi.fn(async (event: StationEvent) => void recorded.push(event)) } as unknown as ActivityRecorder;

    return {
        job: new ExtendLineupJob(
            lineups,
            generator,
            resolver,
            preemption,
            director,
            activity,
            station.config,
            schedule,
            contextFor(options.expiresIn),
            container,
            logger,
        ),
        director,
        recorded: () => recorded,
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

    it("leans into the slot's mood stage, the first when the slot in force is not the broadcast's", async () => {
        const single = build({ moods: ['comfort'], slotId: 'evening' });
        await single.job.run({ count: 5 });
        expect(single.generate.mock.calls[0]![0]!.mood).toBe('comfort');

        const elsewhere = build({ moods: ['sadness', 'anger'], slotId: 'evening', inForce: undefined });
        await elsewhere.job.run({ count: 5 });
        expect(elsewhere.generate.mock.calls[0]![0]!.mood).toBe('sadness');

        const none = build({});
        await none.job.run({ count: 5 });
        expect(none.generate.mock.calls[0]![0]).not.toHaveProperty('mood');
    });

    it('tells the generator nothing about who is presenting', async () => {
        // It used to hand the whole persona over so that its `music` line could reach the model
        // choosing records. A persona is a voice now and says nothing about what the station plays,
        // so a refill is steered by the brief alone and this job never reads one.
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

    it('excludes only the artists at the tail', async () => {
        // Excluding every artist in the lineup would starve a long rotation of its own library: a
        // hundred tracks is sixty artists, and after two refills there is nobody left. So the
        // window is narrow — `maxPerArtist + 1` items — and this is what tells the two apart: the
        // earliest artist in a longer lineup must be left out of the exclusion entirely.
        const { job, seed, generate } = build({
            stationRules: { [ROTATION_KEYS.maxPerArtist]: '1' },
            existing: [track('A', 'One'), track('B', 'Two'), track('C', 'Three')],
        });
        await seed();

        await job.run({ count: 1 });

        expect(generate.mock.calls[0]![0]!.avoidArtistKeys).toEqual(new Set([artistKey(['Two']), artistKey(['Three'])]));
    });

    it('does not exclude any artist when the per-artist cap is off', async () => {
        // The cap and the exclusion are the same knob: a station that has said "no limit on one
        // artist" has said nothing about spacing, which the seed (below) still handles on its own.
        const { job, seed, generate } = build({
            stationRules: { [ROTATION_KEYS.maxPerArtist]: '0' },
            existing: [track('A', 'One'), track('B', 'Two')],
        });
        await seed();

        await job.run({ count: 1 });

        expect(generate.mock.calls[0]![0]!.avoidArtistKeys).toBeUndefined();
    });

    it('holds the last refill’s artists against the next one, by when each will air', async () => {
        // Two refills of fifteen unmeasured records, each counted at four and a half minutes. The
        // second batch begins sixty-seven and a half minutes out, so the records starting in the
        // last forty of that (the eighth onwards) are inside the cooldown and the first seven are
        // not. The fixed tail window saw three of them.
        const { job, generate, resolve } = build();

        await job.run({ count: 15 });
        await job.run({ count: 15 });

        const inside = Array.from({ length: 8 }, (_, index) => artistKey([`Artist${index + 7}`]));
        const outside = Array.from({ length: 7 }, (_, index) => artistKey([`Artist${index}`]));
        const asked = generate.mock.calls[1]![0]!.queuedArtistKeys;
        expect(asked).toEqual(new Set(inside));
        for (const key of outside) expect(asked).not.toContain(key);

        // The resolver judges the same set, and is told how many the station needs so it gives way
        // rather than starve.
        const options = (resolve.mock.calls[1] as unknown[])[2] as { queuedArtistKeys?: ReadonlySet<string>; want?: number };
        expect(options.queuedArtistKeys).toEqual(new Set(inside));
        expect(options.want).toBe(15);
    });

    it.each(['0', ''])('holds nothing against the queue with the cooldown set to %j', async value => {
        const { job, generate, resolve } = build({
            stationRules: { [ROTATION_KEYS.artistCooldownMinutes]: value },
        });

        await job.run({ count: 15 });

        expect(generate.mock.calls[0]![0]!.queuedArtistKeys).toBeUndefined();
        expect(((resolve.mock.calls[0] as unknown[])[1] as { artistCooldownMinutes: number }).artistCooldownMinutes).toBe(0);
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

    // A refill can resolve to nothing without anything having gone wrong, and the station is then
    // running down with a full library — two facts with nothing connecting them unless this says so.
    // The counts are what tell a generator that named nothing apart from a resolver that dropped
    // everything it named, which are different problems with the same symptom.
    it('says so on the feed when a refill comes back with nothing at all', async () => {
        const { job, recorded } = build({
            picks: [
                { title: 'Off brief', artist: 'One' },
                { title: 'Wrong decade', artist: 'Two' },
            ],
            resolvable: () => [],
        });

        await job.run({ count: 2 });

        const event = recorded().find(entry => entry.kind === 'order.refillEmpty');
        expect(event).toBeDefined();
        expect(event?.severity).toBe('warn');
        expect(event?.data).toMatchObject({ asked: 2, named: 2, resolved: 0 });
    });

    it('says nothing on the feed about a refill that actually added records', async () => {
        const { job, recorded } = build({ picks: [{ title: 'Playable', artist: 'One' }] });

        await job.run({ count: 1 });

        expect(recorded().some(entry => entry.kind === 'order.refillEmpty')).toBe(false);
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

    // pg-boss aborts a run at its `expiresIn` and fails the job, so what was planned cannot be
    // posted: the director is about to ask again. What it must not do is vanish, which is what this
    // return did while the station sat silent behind two finished plans on 2026-10-10.
    it('says so on the feed when the run is stopped past its time limit, rather than vanishing', async () => {
        const stop = new AbortController();
        // A limit already spent, which is what pg-boss reclaiming the run looks like from inside it.
        const { job, lineup, recorded, generate } = build({ picks: [{ title: 'Planned', artist: 'One' }], expiresIn: Duration.fromMillis(0) });
        generate.mockImplementationOnce(async () => {
            stop.abort();
            return [{ title: 'Planned', artist: 'One' }];
        });

        await job.run({ count: 1 }, stop.signal);

        expect(lineup.isEmpty()).toBe(true);
        const event = recorded().find(entry => entry.kind === 'order.refillAbandoned');
        expect(event?.severity).toBe('warn');
        expect(event?.data).toEqual({ asked: 1, named: 1 });
        // What it chose, and never "planned 0": a stopped run resolves nothing, so that count is
        // always zero and says nothing about what was lost.
        expect(event?.detail).toMatch(/chose 1 records/);
        expect(logger.warn).toHaveBeenCalledWith('director: the refill ran past its time limit before it could add what it chose', expect.anything());
    });

    // Every deploy stops whatever refill is running, the order is put back at boot, and the refill is
    // asked for again. A warning on the feed each time would teach the operator to skip the one row
    // that matters.
    it('keeps a shutdown off the feed', async () => {
        const stop = new AbortController();
        const { job, recorded, generate } = build({ expiresIn: Duration.fromObject({ minutes: 12 }) });
        generate.mockImplementationOnce(async () => {
            stop.abort();
            return [{ title: 'Planned', artist: 'One' }];
        });

        await job.run({ count: 1 }, stop.signal);

        expect(recorded().some(entry => entry.kind === 'order.refillAbandoned')).toBe(false);
        expect(logger.info).toHaveBeenCalledWith(
            'director: the refill was stopped by a shutdown before it could add what it chose',
            expect.anything(),
        );
    });

    it('does not plan again once the run has been stopped, whatever interrupted the model', async () => {
        const stop = new AbortController();
        const { job, generate } = build({ preemptedTimes: 1 });
        generate.mockImplementationOnce(async () => {
            stop.abort();
            return [];
        });

        await job.run({ count: 5 }, stop.signal);

        expect(generate).toHaveBeenCalledTimes(1);
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

    it('throws the interrupted attempt’s picks away, whatever they were', async () => {
        // A preempted attempt can still answer: `ModelSetGenerator` fills it from what its searches
        // found, so the retry does not lose them when it is the last one. That is only free because
        // the first attempt's answer goes nowhere, which is what this pins.
        const { job, generate, resolve } = build({ preemptedTimes: 1 });
        generate.mockResolvedValueOnce([{ title: 'Interrupted', artist: 'First' }]);

        await job.run({ count: 4 });

        const resolved = resolve.mock.calls[0]![0] as readonly TrackPick[];
        expect(resolved.map(pick => pick.title)).not.toContain('Interrupted');
    });

    it('gives up after one retry, so a busy hour cannot loop', async () => {
        // A station taking a break every few records can preempt the retry too, and the fix for an
        // oversubscribed model is not more attempts. The last attempt answers with what both
        // attempts' searches found, which is `ModelSetGenerator`'s half and tested there.
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

// A refill is generated against the broadcast this job loaded minutes earlier, and the director
// may have moved on to a new one by the time this posts. `broadcastId` is what lets the director
// tell the two apart, and what lets this job refuse to pay for the model at all once it already
// knows the ask is stale.
describe('ExtendLineupJob stamping the command it posts', () => {
    it('posts the command carrying the broadcast it actually loaded', async () => {
        const { job, lineup, posted } = build();

        await job.run({ count: 3 });

        const [command] = posted();
        expect(command).toMatchObject({ kind: 'appendTracks', broadcastId: lineup.broadcastId });
    });

    it('skips generating when the payload names a broadcast the loaded lineup is not', async () => {
        const { job, generate, director } = build();

        await job.run({ count: 3, broadcastId: 'a-broadcast-that-has-ended' });

        expect(generate).not.toHaveBeenCalled();
        expect(director.post).not.toHaveBeenCalled();
    });

    it('generates when the payload names no particular broadcast', async () => {
        // Absent means "whichever the director is airing", the ordinary ask from `topUpIfShort`
        // before this field existed on every caller.
        const { job, generate } = build();

        await job.run({ count: 3 });

        expect(generate).toHaveBeenCalled();
    });

    it('generates when the payload names the broadcast the loaded lineup is', async () => {
        const { job, generate, lineup } = build();

        await job.run({ count: 3, broadcastId: lineup.broadcastId });

        expect(generate).toHaveBeenCalled();
    });
});
