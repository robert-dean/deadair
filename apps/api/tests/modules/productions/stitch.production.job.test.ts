// Joining a production's beats is an IMPROVEMENT to a programme that is already finished, so the
// thing worth pinning here is not that it works. It is that every way it can fail lands in the same
// place: `ready` with no joined row, which is the state the director airs as a block of beats.
//
// The other half is the row it writes when it does work. It is born `ready` deliberately —
// `claimForRender` starts at `written`, so a joined row that began there would eventually be claimed
// by a retry and hand a whole phone-in to the speech engine as one line in one voice.

import { describe, expect, it, vi } from 'vitest';

import { StitchProductionJob } from '../../../src/modules/productions/stitch.production.job.js';
import type { ProductionRepository } from '../../../src/modules/productions/production.repository.js';
import type { Production } from '../../../src/modules/productions/production.js';
import type { SegmentRepository, Segment } from '../../../src/modules/render/segment.repository.js';
import type { SegmentStore } from '../../../src/modules/render/segment.store.js';
import type { AnalysisService } from '../../../src/modules/analysis/analysis.service.js';
import type { MixerService } from '../../../src/modules/render/mixer.service.js';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { AudioUrlSigner } from '../../../src/modules/playout/audio.url.signer.js';

/** Hands URLs back unsigned: what is signed and how is `AudioUrlSigner`'s own test. */
const signer = { sign: (url: string) => url } as unknown as AudioUrlSigner;

vi.mock('../../../src/modules/jobs/job.authorization.js', () => ({ overrideJobActor: vi.fn() }));

const production = (overrides: Partial<Production> = {}): Production =>
    ({
        id: 'prod-1',
        kind: 'callin',
        title: 'Late line',
        state: 'stitching',
        targetMs: 180_000,
        writingMode: 'outlined',
        ...overrides,
    }) as Production;

const beat = (ordinal: number, overrides: Partial<Segment> = {}): Segment =>
    ({
        id: `beat-${ordinal}`,
        kind: 'callin',
        state: 'ready',
        label: `Late line (${ordinal + 1}/3)`,
        script: `turn ${ordinal}`,
        source: 'render',
        productionId: 'prod-1',
        productionOrdinal: ordinal,
        ...overrides,
    }) as Segment;

const audio = () => new Response(new Uint8Array([1, 2, 3])).body!;

function harness(
    options: {
        claimed?: Production | undefined;
        beats?: Segment[];
        joined?: Segment | undefined;
        join?: () => Promise<unknown>;
        gapMs?: string;
    } = {},
) {
    const claimed = 'claimed' in options ? options.claimed : production();

    const productions = {
        claim: vi.fn(async () => claimed),
        moveTo: vi.fn(async () => true),
        fail: vi.fn(async () => true),
    } as unknown as ProductionRepository;

    const segments = {
        beatsOf: vi.fn(async () => options.beats ?? [beat(0), beat(1), beat(2)]),
        joinedOf: vi.fn(async () => options.joined),
        planJoined: vi.fn(async () => ({ id: 'joined-1' }) as Segment),
        recordLoudness: vi.fn(async () => {}),
    } as unknown as SegmentRepository;

    const store = { writeStream: vi.fn(async () => 'checksum-1') } as unknown as SegmentStore;

    // Two doubles, because they are two picks: the mixer joins and the analyzer measures what came
    // back, and a station can have one and not the other.
    const mixer = {
        join: vi.fn(options.join ?? (async () => ({ mime: 'audio/flac', audio: audio(), durationMs: 184_320 }))),
    } as unknown as MixerService;

    const analysis = {
        measureAudio: vi.fn(async () => ({ schemaVersion: 1, complete: true, data: { integratedLufs: -21.5 } })),
    } as unknown as AnalysisService;

    const config = {
        get: vi.fn((key: string, fallback: string) => (key === 'render.productionGapMs' ? (options.gapMs ?? fallback) : fallback)),
    } as unknown as AppConfig;

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const job = new StitchProductionJob(
        productions,
        segments,
        store,
        mixer,
        analysis,
        config,
        signer,
        { id: 'job-1' } as never,
        {} as never,
        logger as never,
    );

    return { job, productions, segments, store, mixer, analysis, logger };
}

describe('StitchProductionJob', () => {
    it('joins the beats in order and writes one row that is ready to air', async () => {
        const { job, segments, store, mixer } = harness();

        await job.run({ productionId: 'prod-1' });

        expect(mixer.join).toHaveBeenCalledWith(
            'Late line',
            // The station's own segment route for each part: the bytes joined are the bytes that
            // aired, and it is reachable from a sidecar container.
            [
                expect.stringContaining('/segments/beat-0/audio'),
                expect.stringContaining('/segments/beat-1/audio'),
                expect.stringContaining('/segments/beat-2/audio'),
            ],
            200,
        );
        expect(store.writeStream).toHaveBeenCalledWith(expect.anything(), 'flac');
        expect(segments.planJoined).toHaveBeenCalledWith({
            productionId: 'prod-1',
            kind: 'callin',
            // The programme's own name, where each beat carried "Late line (2/3)".
            label: 'Late line',
            script: 'turn 0\n\nturn 1\n\nturn 2',
            audioChecksum: 'checksum-1',
            audioExt: 'flac',
            durationMs: 184_320,
        });
    });

    it('measures the joined programme, because none of the beats own figures describe this file', async () => {
        const { job, segments, analysis } = harness();

        await job.run({ productionId: 'prod-1' });

        expect(analysis.measureAudio).toHaveBeenCalledWith('joined-1', expect.stringContaining('/segments/joined-1/audio'));
        expect(segments.recordLoudness).toHaveBeenCalledWith('joined-1', -21.5);
    });

    it('leaves the production ready, which is the state that airs', async () => {
        const { job, productions } = harness();

        await job.run({ productionId: 'prod-1' });

        expect(productions.moveTo).toHaveBeenCalledWith('prod-1', 'ready', 'stitching');
    });

    it('reads the operator gap and clamps a figure past the joiner will take', async () => {
        const { job, mixer } = harness({ gapMs: '9000' });

        await job.run({ productionId: 'prod-1' });

        expect(mixer.join).toHaveBeenCalledWith(expect.anything(), expect.anything(), 2000);
    });

    it('still reaches ready when there is nothing that can join, so the beats air as a block', async () => {
        const { job, productions, segments } = harness({ join: async () => undefined });

        await job.run({ productionId: 'prod-1' });

        expect(segments.planJoined).not.toHaveBeenCalled();
        expect(productions.moveTo).toHaveBeenCalledWith('prod-1', 'ready', 'stitching');
    });

    it('still reaches ready when the join throws', async () => {
        const { job, productions, segments, logger } = harness({
            join: async () => {
                throw new Error('the mixer fell over');
            },
        });

        await job.run({ productionId: 'prod-1' });

        expect(segments.planJoined).not.toHaveBeenCalled();
        expect(productions.moveTo).toHaveBeenCalledWith('prod-1', 'ready', 'stitching');
        expect(logger.warn).toHaveBeenCalled();
    });

    it('refuses audio the station cannot serve rather than storing it under a guess', async () => {
        // A wrong extension is a wrong Content-Type on the way back out, and both consumers of
        // station audio go by that header: it fails as silence rather than as an error.
        const cancel = vi.fn(async () => {});
        const { job, productions, store, segments } = harness({
            join: async () => ({ mime: 'audio/webm', audio: { cancel } as unknown as ReadableStream<Uint8Array> }),
        });

        await job.run({ productionId: 'prod-1' });

        expect(cancel).toHaveBeenCalled();
        expect(store.writeStream).not.toHaveBeenCalled();
        expect(segments.planJoined).not.toHaveBeenCalled();
        expect(productions.moveTo).toHaveBeenCalledWith('prod-1', 'ready', 'stitching');
    });

    it('does not join a production twice', async () => {
        const { job, mixer, productions } = harness({ joined: { id: 'joined-already' } as Segment });

        await job.run({ productionId: 'prod-1' });

        expect(mixer.join).not.toHaveBeenCalled();
        expect(productions.moveTo).toHaveBeenCalledWith('prod-1', 'ready', 'stitching');
    });

    it('spends nothing on a production it could not claim, which is one somebody stopped', async () => {
        const { job, segments, mixer, productions } = harness({ claimed: undefined });

        await job.run({ productionId: 'prod-1' });

        expect(segments.beatsOf).not.toHaveBeenCalled();
        expect(mixer.join).not.toHaveBeenCalled();
        expect(productions.moveTo).not.toHaveBeenCalled();
    });

    it('does nothing at all when it is sent no production', async () => {
        const { job, productions } = harness();

        await job.run({});

        expect(productions.claim).not.toHaveBeenCalled();
    });
});
