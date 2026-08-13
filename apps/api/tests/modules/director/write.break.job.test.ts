// The slow half of planting a break. Every failure here has to end as a row the director skips,
// never as an exception and never as a segment stuck `planned` forever: a break that cannot be
// written must cost the station that break and nothing else.

import { describe, expect, it, vi } from 'vitest';

import { StationLineup } from '../../../src/modules/director/station.lineup.js';
import { WriteBreakJob } from '../../../src/modules/director/write.break.job.js';
import type { RundownTrack } from '../../../src/modules/playout/rundown.js';
import type { Segment } from '../../../src/modules/render/segment.repository.js';
import type { ScriptWrite } from '../../../src/modules/render/script.history.repository.js';

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const track = (title: string, artist: string, trackId?: string): RundownTrack => ({
    pluginId: 'deadair.spotify',
    externalId: title,
    title,
    artists: [artist],
    ...(trackId === undefined ? {} : { trackId }),
});

const planned = (overrides: Partial<Segment> = {}): Segment =>
    ({ id: 'seg-1', kind: 'talkbreak', state: 'writing', label: 'Talk break', source: 'render', ...overrides }) as Segment;

/** A rotation with a break planted between the second and third record. */
const lineupWithBreak = async (segmentId = 'seg-1'): Promise<StationLineup> => {
    const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
    lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake')]);
    lineup.insertSegments([{ segmentId, atIndex: 1 }]);
    return lineup;
};

function harness(
    options: {
        segment?: Segment;
        lineup?: StationLineup;
        written?: unknown;
        wrote?: boolean;
        historyThrows?: boolean;
        /** What the station knows about the records either side, keyed by track id. */
        facts?: Map<string, string[]>;
        factsThrow?: boolean;
    } = {},
) {
    const segments = {
        claimForWrite: vi.fn(async () => ('segment' in options ? options.segment : planned())),
        recentScripts: vi.fn(async () => []),
        writeScript: vi.fn(async () => options.wrote ?? true),
        markFailed: vi.fn(async () => {}),
    };
    const lineups = { load: vi.fn(async () => options.lineup) };
    const history = {
        recordAll: vi.fn(async (_writes: readonly ScriptWrite[]) => options.historyThrows && Promise.reject(new Error('the history table is gone'))),
    };
    const wrote = (script: string, label: string, writer: string) => ({
        written: { script, label },
        writer,
        attempts: [{ writer, outcome: 'written', written: { script, label }, durationMs: 1 }],
    });
    const writers = { write: vi.fn(async () => options.written ?? wrote('talking', 'Talk break: one into two', 'deterministic')) };
    const enrichment = {
        factsForTracks: vi.fn(async (_ids: readonly string[], _rotate?: number) =>
            options.factsThrow ? Promise.reject(new Error('the enrichment tables are gone')) : (options.facts ?? new Map<string, string[]>()),
        ),
    };
    const jobs = { send: vi.fn(async () => {}) };
    const config = { get: vi.fn((_: string, fallback: string) => fallback) };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    // The feed's write side. Only a break that fell through to a second writer reaches it.
    const activity = { record: vi.fn(async (_event: Record<string, unknown>) => undefined) };

    const job = new WriteBreakJob(
        lineups as never,
        segments as never,
        history as never,
        writers as never,
        enrichment as never,
        activity as never,
        jobs as never,
        config as never,
        { id: 'job-1' } as never,
        {} as never,
        logger as never,
    );

    return { job, segments, lineups, history, writers, enrichment, jobs, logger, activity };
}

describe('WriteBreakJob', () => {
    it('writes the script and sends the render', async () => {
        const { job, segments, jobs } = harness({ lineup: await lineupWithBreak() });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', {
            script: 'talking',
            label: 'Talk break: one into two',
            writer: 'deterministic',
        });
        expect(jobs.send).toHaveBeenCalledWith('render.segment', { segmentId: 'seg-1' });
    });

    it('records whichever writer actually spoke, rather than assuming', async () => {
        // The job cannot know: once a kind has more than one writer, the answer that came back has
        // been through however many declined before it. A constant here is the bug where every
        // break claims to be deterministic and a model quietly stops being visible.
        const { job, segments } = harness({
            lineup: await lineupWithBreak(),
            written: {
                written: { script: 'talking', label: 'Talk break: one into two' },
                writer: 'a-model',
                attempts: [
                    { writer: 'a-model', outcome: 'written', written: { script: 'talking', label: 'Talk break: one into two' }, durationMs: 1 },
                ],
            },
        });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ writer: 'a-model' }));
    });

    describe('the record of what it wrote', () => {
        /** A model that threw, and the floor that covered for it. */
        const degraded = {
            written: { script: 'That was Solid Air.', label: 'Back-announce' },
            writer: 'deterministic',
            attempts: [
                { writer: 'a-model', outcome: 'failed', reason: 'out of budget', durationMs: 41 },
                { writer: 'deterministic', outcome: 'written', written: { script: 'That was Solid Air.', label: 'Back-announce' }, durationMs: 1 },
            ],
        };

        it('keeps every attempt, not only the one that produced words', async () => {
            // The floor's row on its own reads as a station that never had a model configured, which
            // is the wrong thing for an operator to conclude at the exact moment their model broke.
            const { job, history } = harness({ lineup: await lineupWithBreak(), written: degraded });

            await job.run({ segmentId: 'seg-1' });

            const written = history.recordAll.mock.calls[0]![0];
            expect(written).toHaveLength(2);
            expect(written[0]).toMatchObject({ writer: 'a-model', outcome: 'failed', reason: 'out of budget', durationMs: 41 });
            expect(written[1]).toMatchObject({ writer: 'deterministic', outcome: 'written', script: 'That was Solid Air.' });
        });

        it('tells the feed a break degraded, and says nothing when one did not', async () => {
            // The two facts the registry answers with every attempt for: that a writer was asked and
            // declined, and that the floor covered. `segments.writer` records who won and cannot say
            // who was asked, so this is not derivable from the row afterwards.
            const fell = harness({ lineup: await lineupWithBreak(), written: degraded });
            await fell.job.run({ segmentId: 'seg-1' });

            expect(fell.activity.record).toHaveBeenCalledOnce();
            expect(fell.activity.record.mock.calls[0]![0]).toMatchObject({
                module: 'render',
                kind: 'break.degraded',
                data: { wrote: 'deterministic' },
            });

            // The ordinary case. A line per break would bury everything else in the feed.
            const clean = harness({ lineup: await lineupWithBreak() });
            await clean.job.run({ segmentId: 'seg-1' });

            expect(clean.activity.record).not.toHaveBeenCalled();
        });

        it('keeps the records the break was written against', async () => {
            // A script that names the wrong record is only diagnosable next to what it was told.
            const { job, history } = harness({ lineup: await lineupWithBreak() });

            await job.run({ segmentId: 'seg-1' });

            expect(history.recordAll.mock.calls[0]?.[0]).toEqual([
                expect.objectContaining({
                    segmentId: 'seg-1',
                    kind: 'talkbreak',
                    previous: { title: 'Solid Air', artist: 'John Martyn' },
                    next: { title: 'Pink Moon', artist: 'Nick Drake' },
                }),
            ]);
        });

        it('keeps the attempt even when nothing could be written', async () => {
            const { job, history } = harness({
                lineup: await lineupWithBreak(),
                written: {
                    attempts: [{ writer: 'deterministic', outcome: 'declined', reason: 'nothing to say', durationMs: 1 }],
                    reason: 'nothing to say',
                },
            });

            await job.run({ segmentId: 'seg-1' });

            expect(history.recordAll.mock.calls[0]?.[0]).toEqual([
                expect.objectContaining({ writer: 'deterministic', outcome: 'declined', reason: 'nothing to say' }),
            ]);
        });

        it('still writes the break when the record of it cannot be kept', async () => {
            // The whole point of it being best-effort: nothing reads this table to decide anything,
            // so losing a row must cost a row and never the break it was describing.
            const { job, segments, jobs } = harness({ lineup: await lineupWithBreak(), historyThrows: true });

            await job.run({ segmentId: 'seg-1' });

            expect(segments.writeScript).toHaveBeenCalled();
            expect(jobs.send).toHaveBeenCalledWith('render.segment', { segmentId: 'seg-1' });
        });
    });

    it('derives the neighbours from the order as it stands now', async () => {
        // Not from the payload: between planting and writing, an operator can move a line and the
        // director can commit. A stale snapshot is how a station back-announces a record it never
        // played, which is the one mistake a listener can catch it out in.
        const { job, writers } = harness({ lineup: await lineupWithBreak() });

        await job.run({ segmentId: 'seg-1' });

        expect(writers.write).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'talkbreak',
                previous: { title: 'Solid Air', artist: 'John Martyn' },
                next: { title: 'Pink Moon', artist: 'Nick Drake' },
            }),
        );
    });

    describe('what the station knows about the records', () => {
        /** The same rotation, with both records catalogued, so there is something to look up. */
        const withIds = (segmentId = 'seg-1'): StationLineup => {
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn', 'track-a'), track('Pink Moon', 'Nick Drake', 'track-b')]);
            lineup.insertSegments([{ segmentId, atIndex: 1 }]);
            return lineup;
        };

        it('puts the facts on both records before anything is asked to write', async () => {
            const { job, writers, enrichment } = harness({
                lineup: withIds(),
                facts: new Map([
                    ['track-a', ['John Martyn was born in New Malden in 1948.']],
                    ['track-b', ['Nick Drake: English singer-songwriter.']],
                ]),
            });

            await job.run({ segmentId: 'seg-1' });

            expect(enrichment.factsForTracks).toHaveBeenCalledWith(['track-a', 'track-b'], expect.any(Number));
            expect(writers.write).toHaveBeenCalledWith(
                expect.objectContaining({
                    previous: {
                        title: 'Solid Air',
                        artist: 'John Martyn',
                        trackId: 'track-a',
                        facts: ['John Martyn was born in New Malden in 1948.'],
                    },
                    next: { title: 'Pink Moon', artist: 'Nick Drake', trackId: 'track-b', facts: ['Nick Drake: English singer-songwriter.'] },
                }),
            );
        });

        it('leaves a record the read had nothing for exactly as it was', async () => {
            const { job, writers } = harness({ lineup: withIds(), facts: new Map([['track-a', ['Born in New Malden in 1948.']]]) });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(
                expect.objectContaining({ next: { title: 'Pink Moon', artist: 'Nick Drake', trackId: 'track-b' } }),
            );
        });

        it('asks nothing about records the catalog does not hold', async () => {
            // Every record on a station playing straight from a provider's playlist, before
            // anything has been ingested. Two neighbours with no ids is not a query worth making.
            const { job, enrichment } = harness({ lineup: await lineupWithBreak() });

            await job.run({ segmentId: 'seg-1' });

            expect(enrichment.factsForTracks).not.toHaveBeenCalled();
        });

        it('writes the break anyway when the facts cannot be read', async () => {
            // A fact makes a break better and never makes it possible. The floor writer never
            // wanted them, and the model has the two records either way.
            const { job, segments, jobs, writers, logger } = harness({ lineup: withIds(), factsThrow: true });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(
                expect.not.objectContaining({ previous: expect.objectContaining({ facts: expect.anything() }) }),
            );
            expect(segments.writeScript).toHaveBeenCalled();
            expect(jobs.send).toHaveBeenCalledWith('render.segment', { segmentId: 'seg-1' });
            expect(logger.warn).toHaveBeenCalledOnce();
        });

        it('keeps the facts a writer was shown on the record of the write', async () => {
            // A break that said nothing interesting and a break that was TOLD nothing interesting
            // read identically from the script, and the tables cannot answer it afterwards.
            const { job, history } = harness({ lineup: withIds(), facts: new Map([['track-a', ['Born in New Malden in 1948.']]]) });

            await job.run({ segmentId: 'seg-1' });

            expect(history.recordAll.mock.calls[0]?.[0]?.[0]).toMatchObject({
                previous: { title: 'Solid Air', facts: ['Born in New Malden in 1948.'] },
            });
        });

        it('asks for the same facts on a retry, so a re-offered break is written from the same notes', async () => {
            const first = harness({ lineup: withIds() });
            await first.job.run({ segmentId: 'seg-1' });
            const second = harness({ lineup: withIds() });
            await second.job.run({ segmentId: 'seg-1' });
            const other = harness({ lineup: withIds('seg-2'), segment: planned({ id: 'seg-2' }) });
            await other.job.run({ segmentId: 'seg-2' });

            const rotation = (call: typeof first) => call.enrichment.factsForTracks.mock.calls[0]![1];
            expect(rotation(second)).toBe(rotation(first));
            expect(rotation(other)).not.toBe(rotation(first));
        });
    });

    it('records the reason on the row when the writer has nothing to say', async () => {
        const { job, segments, jobs } = harness({
            lineup: await lineupWithBreak(),
            written: {
                attempts: [{ writer: 'deterministic', outcome: 'declined', reason: 'nothing to say', durationMs: 1 }],
                reason: 'nothing to say',
            },
        });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', 'nothing to say', 'writing');
        expect(jobs.send).not.toHaveBeenCalled();
    });

    describe('the forward claim', () => {
        it('stamps the line the words actually named', async () => {
            const lineup = await lineupWithBreak();
            const nextItem = lineup.all()[2]!;
            const { job, segments } = harness({
                lineup,
                written: {
                    written: { script: 'Coming up, Pink Moon.', label: 'Talk break', claimsNext: true },
                    writer: 'deterministic',
                    attempts: [
                        { writer: 'deterministic', outcome: 'written', written: { script: 'Coming up, Pink Moon.', label: 'x' }, durationMs: 1 },
                    ],
                },
            });

            await job.run({ segmentId: 'seg-1' });

            expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.objectContaining({ claimsItemId: nextItem.id }));
        });

        it('stamps nothing when the words promised nothing', async () => {
            // A phrasing whose intro was an optional chunk that got dropped made no promise, and a
            // break that promised nothing must not be thrown away later for one it never made.
            const { job, segments } = harness({ lineup: await lineupWithBreak() });

            await job.run({ segmentId: 'seg-1' });

            expect(segments.writeScript).toHaveBeenCalledWith('seg-1', expect.not.objectContaining({ claimsItemId: expect.anything() }));
        });

        it('does not promise a record that has been taken out of the order', async () => {
            // The rewrite case, and the reason this job is re-offered at all: the break is being
            // written again precisely because the record it promised will not air, so reading that
            // line anyway would have it promise the same dead record a second time.
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake')]);
            lineup.insertSegments([{ segmentId: 'seg-1', atIndex: 1 }]);
            lineup.markUnavailable(lineup.all()[2]!.id);
            const { job, writers } = harness({ lineup });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ next: expect.anything() }));
            expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ previous: expect.objectContaining({ title: 'Solid Air' }) }));
        });

        it('back-announces past a record that never played, to the one that did', async () => {
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake'), track('River Man', 'Nick Drake')]);
            lineup.insertSegments([{ segmentId: 'seg-1', atIndex: 2 }]);
            lineup.markUnavailable(lineup.all()[1]!.id);
            const { job, writers } = harness({ lineup });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ previous: expect.objectContaining({ title: 'Solid Air' }) }));
        });

        it('does not offer the next record across another segment', async () => {
            // The least trustworthy promise there is: an intervening segment is the region an
            // operator is most likely to edit, and it may itself air or be skipped. Withholding the
            // record is withholding the claim, and the writers already have phrasings for it.
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake')]);
            lineup.insertSegments([{ segmentId: 'seg-1', atIndex: 1 }]);
            lineup.insertSegments([{ segmentId: 'seg-2', atIndex: 2 }]);
            const { job, writers } = harness({ lineup });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ previous: expect.objectContaining({ title: 'Solid Air' }) }));
            expect(writers.write).toHaveBeenCalledWith(expect.not.objectContaining({ next: expect.anything() }));
        });

        it('still back-announces across another segment, because what played is a fact', async () => {
            const lineup = new StationLineup({ name: 'Afternoons', mode: 'rotation', onEnd: 'extend', source: 'import' });
            lineup.append([track('Solid Air', 'John Martyn'), track('Pink Moon', 'Nick Drake')]);
            lineup.insertSegments([{ segmentId: 'seg-2', atIndex: 1 }]);
            lineup.insertSegments([{ segmentId: 'seg-1', atIndex: 2 }]);
            const { job, writers } = harness({ lineup });

            await job.run({ segmentId: 'seg-1' });

            expect(writers.write).toHaveBeenCalledWith(expect.objectContaining({ previous: expect.objectContaining({ title: 'Solid Air' }) }));
        });
    });

    it('waits rather than writing a break the order does not hold yet', async () => {
        // Measured on the running station: the director writes the order through a throttle, so a
        // break can be planted, offered and picked up here before the row anybody can read holds
        // it. Claiming and writing anyway produced a break that knew neither of its neighbours and,
        // having consumed the claim, was never offered again — which is a station whose every talk
        // break is reduced to saying its own name.
        const { job, segments, writers, jobs } = harness({ lineup: await lineupWithBreak('some-other-break') });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.claimForWrite).not.toHaveBeenCalled();
        expect(writers.write).not.toHaveBeenCalled();
        expect(segments.markFailed).not.toHaveBeenCalled();
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('fails the segment when its running order has gone', async () => {
        const { job, segments } = harness({ lineup: undefined });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.markFailed).toHaveBeenCalledWith('seg-1', expect.stringContaining('gone'), 'writing');
    });

    it('does nothing when the claim was lost', async () => {
        // Another run got there first, or the segment was deleted, or it has already been written.
        // All ordinary races, and all the same answer: the claim is what says whose it is.
        const { job, segments, jobs } = harness({ segment: undefined });

        await job.run({ segmentId: 'seg-1' });

        expect(segments.writeScript).not.toHaveBeenCalled();
        expect(segments.markFailed).not.toHaveBeenCalled();
        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('does not render when the row was claimed between the write and the save', async () => {
        const { job, jobs } = harness({ lineup: await lineupWithBreak(), wrote: false });

        await job.run({ segmentId: 'seg-1' });

        expect(jobs.send).not.toHaveBeenCalled();
    });

    it('warns and stops on a payload with nothing to write', async () => {
        const { job, segments, logger } = harness();

        await job.run({});
        await job.run();

        expect(segments.claimForWrite).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledTimes(2);
    });
});
