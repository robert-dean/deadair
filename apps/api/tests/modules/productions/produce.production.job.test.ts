// The outline pass, which is the one thing between a production and a run of unrelated beats.
//
// It degrades to `quick` when the model gives it nothing usable, which is right — a programme with
// no plan is still a programme, and the plan is arithmetic that has already been done. What was
// wrong was that it did so on the FIRST refusal and said nothing about it anywhere a person looks:
// measured live, 8 of 12 productions aired with `outline` null despite being commissioned
// `outlined`, each beat written blind, and the only trace was an `info` line.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';

import { ProduceProductionJob } from '../../../src/modules/productions/produce.production.job.js';
import type { Production } from '../../../src/modules/productions/production.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const production = (over: Partial<Production> = {}): Production =>
    ({
        id: 'prod-1',
        kind: 'callin',
        title: 'Phone-in',
        state: 'planned',
        writingMode: 'outlined',
        targetMs: 3 * 60_000,
        ...over,
    }) as Production;

/** A usable outline as the model would answer with one. */
const ANSWER = JSON.stringify({ throughline: 'what the eighties sounded like', runners: [], beats: [{ title: 'Opening' }] });

/**
 * The job with only the outline pass wired up.
 *
 * Everything the drafting and checking passes reach for is left unbuilt, which is safe because
 * `outline()` touches none of it — and is what keeps this a test of the retry rather than a fixture
 * for the whole file.
 */
function build(answers: string[]) {
    const claim = vi.fn(async () => production({ state: 'outlining' }));
    const savePlan = vi.fn(async () => true);
    const saveOutline = vi.fn(async () => true);
    const productions = { claim, savePlan, saveOutline } as never;

    // No cast: a monologue, which keeps the plan arithmetic out of the way of what is being tested.
    const caster = { cast: vi.fn(async () => []) } as never;

    let at = 0;
    const converse = vi.fn(async () => ({ text: answers[Math.min(at++, answers.length - 1)] ?? '' }));
    const llm = { converse } as never;

    const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;
    const record = vi.fn(async () => {});
    const activity = { record } as never;

    const job = new ProduceProductionJob(
        productions,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        caster,
        {} as never,
        llm,
        {} as never,
        config,
        activity,
        { id: 'job-1' } as never,
        {} as never,
        logger as never,
    );

    // `outline` is the pass under test and is private, which is a fact about the class rather than
    // about the behaviour: the job dispatches to it by name off the row's own state.
    const outline = (job as unknown as { outline: (input: Production) => Promise<boolean> }).outline.bind(job);

    return { outline, converse, savePlan, saveOutline, record };
}

describe('the outline pass', () => {
    it('asks once and keeps a usable answer', async () => {
        const { outline, converse, saveOutline, savePlan } = build([ANSWER]);

        await outline(production());

        expect(converse).toHaveBeenCalledTimes(1);
        expect(saveOutline).toHaveBeenCalled();
        expect(savePlan).not.toHaveBeenCalled();
    });

    it('asks AGAIN when the first answer is unusable, rather than giving up on the first refusal', async () => {
        // The measured cause is the one model slot being busy, which is a state that passes: a
        // second ask costs one more wait on a background-priority call and nothing on the air path.
        const { outline, converse, saveOutline } = build(['', ANSWER]);

        await outline(production());

        expect(converse).toHaveBeenCalledTimes(2);
        expect(saveOutline).toHaveBeenCalled();
    });

    it('writes the beats from the brief when both asks come back with nothing', async () => {
        // Not a failure of the production. The plan is already computed, so this is exactly what a
        // `quick` production does by design.
        const { outline, converse, savePlan, saveOutline } = build(['', 'not json either']);

        await outline(production());

        expect(converse).toHaveBeenCalledTimes(2);
        expect(savePlan).toHaveBeenCalled();
        expect(saveOutline).not.toHaveBeenCalled();
    });

    it('says on the feed that a programme is being written with no plan', async () => {
        // The half that was missing entirely. A production where nothing answers anything looks
        // exactly like a model that is not very good, and an `info` line is not where anybody looks.
        const { outline, record } = build(['', '']);

        await outline(production());

        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({
                module: 'render',
                kind: 'production.unplanned',
                detail: expect.stringContaining('without an outline'),
            }),
        );
    });

    it('says nothing on the feed when the outline worked', async () => {
        const { outline, record } = build([ANSWER]);

        await outline(production());

        expect(record).not.toHaveBeenCalled();
    });
});

// The station has one speech engine and a programme is many consecutive takes on it. `SpeechGate`
// orders by rank and never preempts, so the beats went in at `air`, the same rank as a break, and a
// break planted while a programme was being spoken waited behind every remaining beat.
describe('sending the beats to be spoken', () => {
    /** The job with only what `render` touches wired up, on this file's own pattern. */
    function buildRender(beats: readonly { id: string }[]) {
        const moveTo = vi.fn(async () => true);
        const productions = { moveTo } as never;
        const segments = { beatsOf: vi.fn(async () => beats) } as never;
        const send = vi.fn(async () => {});
        const jobs = { send } as never;
        const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

        const job = new ProduceProductionJob(
            productions,
            segments,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            jobs,
            config,
            { record: vi.fn(async () => {}) } as never,
            { id: 'job-1' } as never,
            {} as never,
            logger as never,
        );

        const render = (job as unknown as { render: (input: Production) => Promise<void> }).render.bind(job);
        return { render, send, moveTo };
    }

    it('spends the engine on a programme that is nearly due, at the same rank as a break', async () => {
        const { render, send } = buildRender([{ id: 'beat-1' }, { id: 'beat-2' }]);

        await render(production({ state: 'checking', scheduledFor: Date.now() + 60_000 }));

        expect(send).toHaveBeenCalledWith('render.segment', { segmentId: 'beat-1', priority: 'air' });
        expect(send).toHaveBeenCalledWith('render.segment', { segmentId: 'beat-2', priority: 'air' });
    });

    it('yields to the station for a programme whose slot is hours off', async () => {
        const { render, send } = buildRender([{ id: 'beat-1' }]);

        await render(production({ state: 'checking', scheduledFor: Date.now() + 6 * 60 * 60_000 }));

        expect(send).toHaveBeenCalledWith('render.segment', { segmentId: 'beat-1', priority: 'background' });
    });

    it('treats a production nobody scheduled as background, since nothing is waiting on it', async () => {
        // The standing call-in rule writes no `scheduledFor`: such a production airs when it is
        // ready rather than at an instant somebody chose.
        const { render, send } = buildRender([{ id: 'beat-1' }]);

        await render(production({ state: 'checking' }));

        expect(send).toHaveBeenCalledWith('render.segment', { segmentId: 'beat-1', priority: 'background' });
    });

    it('sends nothing when the row was not there to claim', async () => {
        const { render, send, moveTo } = buildRender([{ id: 'beat-1' }]);
        moveTo.mockResolvedValueOnce(false);

        await render(production({ state: 'checking' }));

        expect(send).not.toHaveBeenCalled();
    });
});
