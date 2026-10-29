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
import { LlmGate } from '../../../src/modules/llm/llm.gate.js';
import { LlmService } from '../../../src/modules/llm/llm.service.js';
import { ToolRegistry } from '../../../src/modules/llm/llm.tools.js';
import { PRODUCTION_REASONING_KEY } from '../../../src/modules/productions/production.settings.js';
import { SCRIPT_HISTORY_KEYS } from '../../../src/modules/render/script.history.settings.js';
import { ModelHealth } from '../../../src/modules/llm/model.health.js';

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

/** What `LlmService` answers when a break takes the model back mid-generation: no text, and no throw. */
const PREEMPTED = { text: '', finishReason: 'preempted' };

/** A usable outline as the model would answer with one. */
const ANSWER = JSON.stringify({ throughline: 'what the eighties sounded like', runners: [], beats: [{ title: 'Opening' }] });

/**
 * The job with only the outline pass wired up.
 *
 * Everything the drafting and checking passes reach for is left unbuilt, which is safe because
 * `outline()` touches none of it — and is what keeps this a test of the retry rather than a fixture
 * for the whole file.
 */
function build(answers: (string | { text: string; finishReason: string })[], claimed: Partial<Production> = {}) {
    const claim = vi.fn(async () => production({ state: 'outlining', ...claimed }));
    const savePlan = vi.fn(async () => true);
    const saveOutline = vi.fn(async () => true);
    const productions = { claim, savePlan, saveOutline } as never;

    // No cast: a monologue, which keeps the plan arithmetic out of the way of what is being tested.
    const caster = { cast: vi.fn(async () => []) } as never;

    let at = 0;
    const converse = vi.fn(async () => {
        const answer = answers[Math.min(at++, answers.length - 1)] ?? '';
        return typeof answer === 'string' ? { text: answer, finishReason: 'stop' } : answer;
    });
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
        {} as never,
        {} as never,
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
        // A bad roll: asked again once, on the drafting loop's `EMPTY_BEAT_RETRIES`.
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
                detail: expect.stringContaining('without an outline: the model could not plan it, twice'),
            }),
        );
    });

    it('asks again after a preemption without spending the one retry an unusable answer gets', async () => {
        // The measured cause on 2026-10-20: three banters in a row aired with no outline, five of
        // their six asks cut off by a break or a bulletin wanting the model. A preempted ask is not
        // the model's answer at all, so it is not an attempt.
        const { outline, converse, saveOutline, record } = build([PREEMPTED, '', PREEMPTED, ANSWER]);

        await outline(production({ kind: 'banter' }));

        expect(converse).toHaveBeenCalledTimes(4);
        expect(saveOutline).toHaveBeenCalled();
        expect(record).not.toHaveBeenCalled();
    });

    it('gives up after enough preemptions, and the feed blames the breaks rather than the model', async () => {
        // Still bounded: a station that is never quiet would otherwise hold the job forever.
        const { outline, converse, savePlan, record } = build([PREEMPTED]);

        await outline(production({ kind: 'banter' }));

        expect(converse).toHaveBeenCalledTimes(4);
        expect(savePlan).toHaveBeenCalled();
        expect(record).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'production.unplanned',
                detail: expect.stringContaining('breaks took the model back from it 4 times'),
                data: expect.objectContaining({ reason: 'preempted' }),
            }),
        );
        expect(record).not.toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('could not plan it') }));
    });

    it('counts an ask that ran out of its own budget as an attempt, and says so', async () => {
        // The gate stops it the same way, but nothing took the model: it had the whole budget.
        const { outline, converse, savePlan, record } = build(['', { text: '', finishReason: 'budget' }]);

        await outline(production());

        expect(converse).toHaveBeenCalledTimes(2);
        expect(savePlan).toHaveBeenCalled();
        expect(record).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('because it ran out of time') }));
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
// Notes are what a grounded programme may state as fact. The outline is handed them by index and
// divides them between the beats; an index it names has to survive, since it was hard-wired to keep
// none while nothing handed the outline any.
describe('the outline pass with notes', () => {
    const notes = ['The TR-808 came out in 1980.', 'Roland stopped making it in 1983.'];
    const planned = JSON.stringify({ throughline: 'the machine nobody wanted', runners: [], beats: [{ title: 'Opening', itemIndexes: [0, 1, 7] }] });

    it('hands the outline the notes, with the sentence that holds it to them', async () => {
        const { outline, converse } = build([planned], { notes });

        await outline(production({ notes }));

        const user = String((converse.mock.calls[0] as unknown as [{ messages: { content: string }[] }])[0].messages[1]?.content);
        expect(user).toContain('0. The TR-808 came out in 1980.');
        expect(user).toContain('1. Roland stopped making it in 1983.');
        expect(user).toContain('These notes are everything the station knows about this.');
        expect(user).not.toContain('You have been given no source material');
    });

    it('keeps the notes a beat names and drops an index past the end', async () => {
        const { outline, saveOutline } = build([planned], { notes });

        await outline(production({ notes }));

        const saved = (saveOutline.mock.calls[0] as unknown as [string, { beats: { itemIndexes?: number[] }[] }])[1];
        expect(saved.beats[0]?.itemIndexes).toEqual([0, 1]);
    });
});

// A production handed sources reads them before anything is written, and keeps only the claims whose
// words really are in what it read. One that finds nothing fails, rather than being written from
// general knowledge as a programme nobody asked for.
describe('the research pass', () => {
    const SOURCE = { title: 'A history of the 808', text: 'The TR-808 came out in 1980. Roland stopped making it in 1983.' };

    function buildResearch(
        answers: string[],
        options: {
            cancelled?: boolean;
            sources?: Production['sources'];
            research?: boolean;
            canResearch?: boolean;
            read?: (url: string) => Promise<unknown>;
            found?: unknown[];
        } = {},
    ) {
        const claim = vi.fn(async () =>
            production({
                state: 'researching',
                writingMode: 'quick',
                ...(options.research === true ? { research: true as const } : { sources: options.sources ?? [SOURCE] }),
                brief: 'the machine nobody wanted',
            }),
        );
        const saveNotes = vi.fn(async () => true);
        const saveSources = vi.fn(async () => true);
        const fail = vi.fn(async () => true);
        const isCancelled = vi.fn(async () => options.cancelled ?? false);
        const productions = { claim, saveNotes, saveSources, fail, isCancelled } as never;
        const read = vi.fn(options.read ?? (async () => undefined));
        const documentsAbout = vi.fn(async (_subject: string) => options.found ?? []);

        let at = 0;
        const converse = vi.fn(async (_request: { messages: { content: string }[] }) => ({
            text: answers[Math.min(at++, answers.length - 1)] ?? '',
        }));
        const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

        const job = new ProduceProductionJob(
            productions,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            { converse } as never,
            {} as never,
            config,
            { record: vi.fn(async () => {}) } as never,
            { read } as never,
            { canResearch: () => options.canResearch ?? true, documentsAbout } as never,
            { id: 'job-1' } as never,
            {} as never,
            logger as never,
        );

        const research = (job as unknown as { research: (input: Production) => Promise<boolean> }).research.bind(job);
        return { research, converse, saveNotes, saveSources, fail, read, documentsAbout };
    }

    it('writes the claims it could find in the source as the notes', async () => {
        const answer = JSON.stringify({
            facts: [
                { claim: 'The TR-808 was released in 1980.', quote: 'The TR-808 came out in 1980.' },
                { claim: 'It was designed in Tokyo.', quote: 'designed in Tokyo' },
            ],
        });
        const { research, converse, saveNotes, fail } = buildResearch([answer]);

        expect(await research(production({ sources: [SOURCE] }))).toBe(true);

        expect(saveNotes).toHaveBeenCalledWith('prod-1', ['The TR-808 was released in 1980.']);
        expect(fail).not.toHaveBeenCalled();
        expect(String(converse.mock.calls[0]?.[0].messages[1]?.content)).toContain('The programme is about: the machine nobody wanted');
    });

    it('fails a production whose sources gave nothing it could state as fact', async () => {
        const { research, saveNotes, fail } = buildResearch([JSON.stringify({ facts: [{ claim: 'Invented.', quote: 'not in the source' }] })]);

        expect(await research(production({ sources: [SOURCE] }))).toBe(false);

        expect(saveNotes).not.toHaveBeenCalled();
        expect(fail).toHaveBeenCalledWith('prod-1', 'its sources gave nothing the station could state as fact');
    });

    // A source handed over as only an address is read through whichever plugin can, written back onto the
    // row, and then researched like any other.
    it('reads a source that is only an address before taking notes from it', async () => {
        const page = { url: 'https://example.com/808', title: 'A history of the 808', text: SOURCE.text, retrievedAt: '2026-10-12T08:00:00.000Z' };
        const answer = JSON.stringify({ facts: [{ claim: 'The TR-808 was released in 1980.', quote: 'The TR-808 came out in 1980.' }] });
        const { research, read, saveSources, saveNotes } = buildResearch([answer], {
            sources: [{ title: 'https://example.com/808', url: 'https://example.com/808' }],
            read: async () => page,
        });

        expect(await research(production())).toBe(true);

        expect(read).toHaveBeenCalledWith('https://example.com/808');
        expect(saveSources).toHaveBeenCalledWith('prod-1', [
            { title: 'A history of the 808', url: 'https://example.com/808', text: SOURCE.text, retrievedAt: Date.parse(page.retrievedAt) },
        ]);
        expect(saveNotes).toHaveBeenCalledWith('prod-1', ['The TR-808 was released in 1980.']);
    });

    it('fails the production with the reason when a page could not be read', async () => {
        const { research, converse, fail } = buildResearch(['{}'], {
            sources: [{ title: 'https://example.com/808', url: 'https://example.com/808' }],
            read: async () => {
                throw new Error('could not read example.com (deadair.rss: 503)');
            },
        });

        expect(await research(production())).toBe(false);

        expect(fail).toHaveBeenCalledWith('prod-1', 'could not read example.com (deadair.rss: 503)');
        expect(converse).not.toHaveBeenCalled();
    });

    // Asked to research itself and handed nothing, a production finds pages about its subject on the
    // operator's trusted sites, keeps them as its sources and takes notes from them as from any other.
    it('finds pages about its subject when it was asked to research itself', async () => {
        const page = { url: 'https://example.com/808', title: 'A history of the 808', text: SOURCE.text, retrievedAt: '2026-10-12T08:00:00.000Z' };
        const answer = JSON.stringify({ facts: [{ claim: 'The TR-808 was released in 1980.', quote: 'The TR-808 came out in 1980.' }] });
        const { research, documentsAbout, saveSources, saveNotes } = buildResearch([answer], { research: true, found: [page] });

        expect(await research(production())).toBe(true);

        expect(documentsAbout).toHaveBeenCalledWith('the machine nobody wanted');
        expect(saveSources).toHaveBeenCalledWith('prod-1', [
            { title: 'A history of the 808', url: 'https://example.com/808', text: SOURCE.text, retrievedAt: Date.parse(page.retrievedAt) },
        ]);
        expect(saveNotes).toHaveBeenCalledWith('prod-1', ['The TR-808 was released in 1980.']);
    });

    it('fails, rather than writing from general knowledge, when no trusted site had anything', async () => {
        const { research, converse, fail } = buildResearch(['{}'], { research: true, found: [] });

        expect(await research(production())).toBe(false);

        expect(fail).toHaveBeenCalledWith('prod-1', 'no trusted site had anything on this');
        expect(converse).not.toHaveBeenCalled();
    });

    it('says what to install when nothing can research a subject at all', async () => {
        const { research, documentsAbout, fail } = buildResearch(['{}'], { research: true, canResearch: false });

        expect(await research(production())).toBe(false);

        expect(documentsAbout).not.toHaveBeenCalled();
        expect(fail).toHaveBeenCalledWith('prod-1', expect.stringContaining('the web search plugin can, once it has trusted sites'));
    });

    it('stops reading when the production was cancelled', async () => {
        const { research, converse, saveNotes } = buildResearch(['{}'], { cancelled: true });

        expect(await research(production({ sources: [SOURCE] }))).toBe(false);

        expect(converse).not.toHaveBeenCalled();
        expect(saveNotes).not.toHaveBeenCalled();
    });
});

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
            {} as never,
            {} as never,
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

// Every `polished` production on the live station stopped in `rendering` with its beats written and
// none of them spoken. The check pass moved the row to `rendering` itself, so `render`, which moves
// it there guarded on `checking` or `drafting`, found nothing to move and sent nothing. The tests
// above stub `moveTo` to always succeed, which is exactly the guard that bit, so this one holds the
// state the way the table does and runs the real last pass into the real render.
describe('the last pass of a polished production', () => {
    function buildLastPass(beats: readonly { id: string }[]) {
        let state: Production['state'] = 'checking';
        const row = () => production({ state, writingMode: 'polished' });
        const productions = {
            findById: vi.fn(async () => row()),
            claim: vi.fn(async (_id: string, from: Production['state'], to: Production['state']) => {
                if (state !== from) return undefined;
                state = to;
                return row();
            }),
            moveTo: vi.fn(async (_id: string, to: Production['state'], from: Production['state'] | readonly Production['state'][]) => {
                const allowed: readonly Production['state'][] = Array.isArray(from) ? from : [from];
                if (!allowed.includes(state)) return false;
                state = to;
                return true;
            }),
            isCancelled: vi.fn(async () => false),
            fail: vi.fn(async () => true),
        } as never;
        const segments = { beatsOf: vi.fn(async () => beats) } as never;
        const personas = { presenting: vi.fn(async () => undefined), find: vi.fn(async () => undefined) } as never;
        const speech = { cues: vi.fn(async () => []) } as never;
        const send = vi.fn(async () => {});
        const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

        const job = new ProduceProductionJob(
            productions,
            segments,
            {} as never,
            personas,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            speech,
            {} as never,
            { send } as never,
            config,
            { record: vi.fn(async () => {}) } as never,
            {} as never,
            {} as never,
            { id: 'job-1' } as never,
            {} as never,
            logger as never,
        );

        const execute = (job as unknown as { execute: (payload: { productionId: string; pass: string }) => Promise<void> }).execute.bind(job);
        return { execute, send, state: () => state };
    }

    it('sends every beat to be spoken once the check pass is done', async () => {
        const { execute, send, state } = buildLastPass([{ id: 'beat-1' }, { id: 'beat-2' }]);

        await execute({ productionId: 'prod-1', pass: 'check' });

        expect(send).toHaveBeenCalledWith('render.segment', expect.objectContaining({ segmentId: 'beat-1' }));
        expect(send).toHaveBeenCalledWith('render.segment', expect.objectContaining({ segmentId: 'beat-2' }));
        expect(state()).toBe('rendering');
    });
});

// No production is ever handed a weather reading, so a host describing the sky made it up. The check
// pass is where that is caught, and what it hands `checkBeat` decides whether a host answering a
// caller's own weather is refused for it, so this runs the real pass over a real three-turn call.
// Rationing a signature inside one programme was not enough: a banter is commissioned every thirty
// minutes, each started with nothing spent, and Garth said "We fear change" in 23 of 99 banter beats
// without once saying it after being told it was spent.
describe("a speaker's signatures spent before the programme", () => {
    const PLAN = { beats: [0, 1].map((speaker, ordinal) => ({ ordinal, speaker, words: 12 })) } as never;
    const CAST = [
        { role: 'host', name: 'Garth', personaId: 'p-garth' },
        { role: 'host', name: 'Wayne', personaId: 'p-wayne' },
    ] as never;
    const garth = { id: 'p-garth', key: 'garth', label: 'Garth', style: 'a shy drummer', catchphrases: ['We fear change'] };
    const wayne = { id: 'p-wayne', key: 'wayne', label: 'Wayne', style: 'a metalhead', catchphrases: ['Party on'] };

    async function redrafted(
        spokenBy: (key: string, withinMs: number, limit: number, options?: { excludingProduction?: string }) => Promise<string[]>,
    ) {
        const beats = ['Um. Drums.', 'Excellent, Garth.'].map((script, index) => ({
            id: `beat-${index}`,
            script,
            label: 'Banter',
            pads: [],
            productionOrdinal: index,
        }));
        const productions = {
            claim: vi.fn(async () => production({ state: 'checking', writingMode: 'polished', plan: PLAN, casting: CAST })),
            isCancelled: vi.fn(async () => false),
        } as never;
        const segments = { beatsOf: vi.fn(async () => beats), writeScript: vi.fn(async () => {}) } as never;
        const history = { spokenBy: vi.fn(spokenBy) };
        const personas = {
            presenting: vi.fn(async () => undefined),
            find: vi.fn(async (id: string) => [garth, wayne].find(p => p.id === id)),
        } as never;
        const speech = { cues: vi.fn(async () => []) } as never;
        const converse = vi.fn(async (_conversation: { messages: { content: string }[] }) => ({ text: 'Rewritten.' }));
        const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

        const job = new ProduceProductionJob(
            productions,
            segments,
            history as never,
            personas,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            speech,
            { converse } as never,
            {} as never,
            config,
            { record: vi.fn(async () => {}) } as never,
            {} as never,
            {} as never,
            { id: 'job-1' } as never,
            {} as never,
            logger as never,
        );

        const check = (job as unknown as { check: (input: Production) => Promise<boolean> }).check.bind(job);
        await check(production({ id: 'prod-1', state: 'checking' }));

        // Each re-draft's prompt, in beat order. Beats this short are re-drafted for their length.
        return { history, asked: converse.mock.calls.map(([conversation]) => conversation.messages.map(message => message.content).join('\n')) };
    }

    it('tells a speaker a signature they said in the last hour is spent, and not the other speaker', async () => {
        const { asked } = await redrafted(async key => (key === 'garth' ? ['Um. We fear change, Wayne.'] : []));

        expect(asked[0]).toContain('You have already said "We fear change" recently');
        expect(asked[1]).not.toMatch(/already said/);
    });

    it("reads every speaker's hour without this programme's own beats", async () => {
        const { history } = await redrafted(async () => []);

        expect(history.spokenBy).toHaveBeenCalledWith('garth', 60 * 60 * 1000, expect.any(Number), { excludingProduction: 'prod-1' });
        expect(history.spokenBy).toHaveBeenCalledWith('wayne', 60 * 60 * 1000, expect.any(Number), { excludingProduction: 'prod-1' });
    });

    it('still re-drafts when the read fails, with nothing spent', async () => {
        const { asked } = await redrafted(async () => Promise.reject(new Error('the history table is gone')));

        expect(asked.length).toBeGreaterThan(0);
        expect(asked[0]).not.toMatch(/already said/);
    });
});

describe('weather in a phone-in', () => {
    const PLAN = { beats: [0, 1, 0].map((speaker, ordinal) => ({ ordinal, speaker, words: 12 })) } as never;
    const CAST = [
        { role: 'host', name: 'Max' },
        { role: 'caller', name: 'Dale' },
    ] as never;

    async function redraft(scripts: readonly string[], over: Partial<Production> = {}, values: Record<string, string> = {}) {
        const beats = scripts.map((script, index) => ({ id: `beat-${index}`, script, label: 'Phone-in', pads: [], productionOrdinal: index }));
        const productions = {
            claim: vi.fn(async () => production({ state: 'checking', writingMode: 'polished', plan: PLAN, casting: CAST, ...over })),
            isCancelled: vi.fn(async () => false),
        } as never;
        const segments = { beatsOf: vi.fn(async () => beats), writeScript: vi.fn(async () => {}) } as never;
        const personas = { presenting: vi.fn(async () => undefined), find: vi.fn(async () => undefined) } as never;
        const speech = { cues: vi.fn(async () => []) } as never;
        const converse = vi.fn(async (_conversation: { messages: { content: string }[]; reasoningEffort?: string }) => ({ text: 'Rewritten.' }));
        const config = { get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) } as unknown as AppConfig;

        const job = new ProduceProductionJob(
            productions,
            segments,
            {} as never,
            personas,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            {} as never,
            speech,
            { converse } as never,
            {} as never,
            config,
            { record: vi.fn(async () => {}) } as never,
            {} as never,
            {} as never,
            { id: 'job-1' } as never,
            {} as never,
            logger as never,
        );

        const check = (job as unknown as { check: (input: Production) => Promise<boolean> }).check.bind(job);
        await check(production({ state: 'checking' }));

        return converse.mock.calls.map(([conversation]) => conversation);
    }

    async function corrections(scripts: readonly string[], over: Partial<Production> = {}) {
        const asked = await redraft(scripts, over);

        // Every re-draft's prompt. Beats this short are all re-drafted for their length, so a test
        // asks what each one was TOLD rather than whether it was re-drafted at all.
        return asked.map(conversation => conversation.messages.map(message => message.content).join('\n'));
    }

    it('asks for each re-draft with the effort the operator set for productions', async () => {
        const scripts = ['Dale, you are on the air.', 'Thanks Max.', 'Do ring again soon, Dale.'];

        const unset = await redraft(scripts);
        const none = await redraft(scripts, {}, { [PRODUCTION_REASONING_KEY]: 'none' });

        expect(unset.length).toBeGreaterThan(0);
        expect(unset.every(conversation => conversation.reasoningEffort === 'low')).toBe(true);
        expect(none.every(conversation => conversation.reasoningEffort === 'none')).toBe(true);
    });

    it("tells the host to drop weather nobody gave the call, and leaves the caller's own alone", async () => {
        const told = await corrections([
            'Sunny out there this afternoon, and Dale, you are on the air.',
            'Thanks Max, it has been raining here all week, mind.',
            'Glad you rang in, Dale, and do ring again soon.',
        ]);

        expect(told.filter(prompt => prompt.includes('no weather to report'))).toHaveLength(1);
        expect(told.find(prompt => prompt.includes('no weather to report'))).toContain('"Sunny"');
    });

    it('lets the host answer weather the caller raised', async () => {
        const told = await corrections([
            'Dale, you are on the air, what is on your mind today?',
            'Thanks Max, it has been raining here all week, mind.',
            'Raining there too, is it, Dale? Do ring again soon.',
        ]);

        expect(told.some(prompt => prompt.includes('no weather to report'))).toBe(false);
    });

    it('lets the host talk about the weather an operator asked the call to be about', async () => {
        const told = await corrections(
            ['Windy out there, so Dale, you are on the air.', 'Thanks Max, the fence came down.', 'Glad you rang in, Dale, mind the fence.'],
            { brief: 'Callers on the windy weekend' },
        );

        expect(told.some(prompt => prompt.includes('no weather to report'))).toBe(false);
    });
});

// A beat whose conversation THROWS used to leave no `script_history` row at all, so whatever the
// model was paid for before it failed vanished, and `/scripts` showed a programme that failed with
// no attempt behind it. The throw still fails the production exactly as before; what changed is the
// row it leaves behind.
describe('ProduceProductionJob drafting a beat whose model fails', () => {
    const PLAN = { beats: [{ ordinal: 0, speaker: 0, words: 12 }] } as never;
    const CAST = [{ role: 'host', name: 'Max', personaKey: 'max' }] as never;

    async function draftWith(converse: (...args: never[]) => Promise<unknown>, values: Record<string, string> = {}, over: Partial<Production> = {}) {
        const productions = {
            claim: vi.fn(async () => production({ state: 'drafting', writingMode: 'quick', plan: PLAN, casting: CAST, ...over })),
            isCancelled: vi.fn(async () => false),
        } as never;
        const recordAll = vi.fn(async (_rows: unknown[]) => {});
        const personas = { presenting: vi.fn(async () => undefined), find: vi.fn(async () => undefined) } as never;
        const pads = { onSet: vi.fn(async () => []), named: vi.fn(async () => undefined), markUsed: vi.fn(async () => {}) } as never;
        const notes = { forPrompt: vi.fn(async () => []), markUsed: vi.fn(async () => {}) } as never;
        const stories = { forPrompt: vi.fn(async () => undefined) } as never;
        const speech = { cues: vi.fn(async () => []) } as never;
        const config = { get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) } as unknown as AppConfig;

        const job = new ProduceProductionJob(
            productions,
            {} as never,
            { recordAll } as never,
            personas,
            pads,
            notes,
            stories,
            { record: vi.fn(async () => {}) } as never,
            {} as never,
            speech,
            { converse } as never,
            {} as never,
            config,
            { record: vi.fn(async () => {}) } as never,
            {} as never,
            {} as never,
            { id: 'job-1' } as never,
            {} as never,
            logger as never,
        );

        const draft = (job as unknown as { draft: (input: Production) => Promise<boolean> }).draft.bind(job);
        const thrown = await draft(production({ state: 'drafting' })).catch((error: unknown) => error);

        return { thrown, rows: recordAll.mock.calls.flatMap(([rows]) => rows) as Record<string, unknown>[] };
    }

    /** An error exactly as `LlmService` throws one after a billed step: the spend noted beside it. */
    async function spentFailure(): Promise<unknown> {
        let calls = 0;
        const record = {
            id: 'deadair.llm',
            dir: '/plugins/llm',
            status: 'active',
            manifest: { capabilities: ['llm'] },
            instance: {
                generate: async () => {
                    calls += 1;
                    if (calls > 1) throw new Error('the provider fell over');
                    return {
                        text: new ReadableStream<string>({ start: controller => controller.close() }),
                        result: Promise.resolve({ text: '', toolCalls: [], usage: { inputTokens: 900, totalTokens: 1700 }, finishReason: 'length' }),
                    };
                },
                listModels: async () => [{ id: 'the-model', label: 'the-model', default: true }],
            },
        };
        const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;
        const service = new LlmService(
            { list: () => [record] } as never,
            { invoke: async (_id: string, _op: string, work: () => Promise<unknown>) => await work() } as never,
            new LlmGate(logger as never),
            new ToolRegistry([], logger as never),
            config,
            logger as never,
            new ModelHealth(),
        );
        return await service.converse({ messages: [{ role: 'user', content: 'a beat' }] }, { tools: false }).catch((error: unknown) => error);
    }

    // A `quick` production has no outline, so the station divides the notes itself and every beat
    // is told its own share and that they are everything the station knows.
    it('tells a beat of a production with notes what it covers and that the notes are all there is', async () => {
        const converse = vi.fn(async (_request: { messages: { content: string }[] }) => {
            throw new Error('stop after the first beat');
        });

        await draftWith(converse as never, {}, { notes: ['The TR-808 came out in 1980.'] });

        const user = String(converse.mock.calls[0]?.[0].messages[1]?.content);
        expect(user).toContain('What this beat covers:\n- The TR-808 came out in 1980.');
        expect(user).toContain('These notes are everything the station knows about this.');
    });

    it('asks for a beat with the effort the operator set for productions, and `low` when nobody did', async () => {
        // The live failure: every beat sent `low`, the station's model spent its whole allowance
        // thinking at it, and not one production in two weeks aired.
        const stop = () =>
            vi.fn(async (_request: { reasoningEffort?: string }) => {
                throw new Error('stop after the first beat');
            });
        const unset = stop();
        const none = stop();

        await draftWith(unset as never);
        await draftWith(none as never, { [PRODUCTION_REASONING_KEY]: 'none' });

        expect(unset.mock.calls[0]?.[0].reasoningEffort).toBe('low');
        expect(none.mock.calls[0]?.[0].reasoningEffort).toBe('none');
    });

    it('asks a beat of a production with no notes exactly what it always did', async () => {
        const converse = vi.fn(async (_request: { messages: { content: string }[] }) => {
            throw new Error('stop after the first beat');
        });

        await draftWith(converse as never);

        const user = String(converse.mock.calls[0]?.[0].messages[1]?.content);
        expect(user).not.toContain('What this beat covers');
        expect(user).not.toContain("covers none of the programme's notes");
    });

    it('leaves a failed row carrying what the steps before the failure spent', async () => {
        const failure = await spentFailure();

        const { thrown, rows } = await draftWith(async () => {
            throw failure;
        });

        // Still thrown, so the production fails exactly as it did.
        expect(thrown).toBe(failure);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            kind: 'callin',
            writer: 'model',
            outcome: 'failed',
            personaKey: 'max',
            reason: 'the model writer failed: the provider fell over',
            usage: { inputTokens: 900, totalTokens: 1700 },
        });
        expect(rows[0]).not.toHaveProperty('prompt');
    });

    it('records an empty answer that was asked again before the retry threw, without counting anything twice', async () => {
        // Two conversations, each with its own bill: the empty one (500) and the retry, which spent
        // 1700 on a step and then failed. Each row carries its own, and neither carries the other's.
        const failure = await spentFailure();
        let calls = 0;

        const { thrown, rows } = await draftWith(
            async () => {
                calls += 1;
                if (calls > 1) throw failure;
                return {
                    text: '',
                    toolCalls: [],
                    finishReason: 'stop',
                    usage: { totalTokens: 500 },
                    model: 'the-model',
                    toolCallsMade: 0,
                    transcript: [],
                };
            },
            { [SCRIPT_HISTORY_KEYS.capture]: 'true' },
        );

        expect(thrown).toBe(failure);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
            outcome: 'failed',
            reason: 'the model answered with nothing that could be spoken',
            personaKey: 'max',
            usage: { totalTokens: 500 },
            raw: '',
        });
        expect(rows[0]?.prompt).toEqual(expect.any(Array));
        expect(rows[1]).toMatchObject({
            outcome: 'failed',
            reason: 'the model writer failed: the provider fell over',
            usage: { inputTokens: 900, totalTokens: 1700 },
        });
    });

    it('leaves a failed row with no figure when nothing was billed before the throw', async () => {
        const { rows } = await draftWith(async () => {
            throw new Error('the model refused');
        });

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ outcome: 'failed', reason: 'the model writer failed: the model refused' });
        expect(rows[0]).not.toHaveProperty('usage');
    });

    it('keeps the prompt on the row only while the operator asked for captures', async () => {
        const { rows } = await draftWith(
            async () => {
                throw new Error('the model refused');
            },
            { [SCRIPT_HISTORY_KEYS.capture]: 'true' },
        );

        expect(rows[0]?.prompt).toEqual(expect.any(Array));
        expect(rows[0]).not.toHaveProperty('raw');
    });
});

// The record check is the one part of the check pass the draft pass runs too, because `outlined` and
// `quick` have no check pass. Measured live on 2026-10-20: a banter co-host named "Blue Monday by New
// Order" in three turns, a record nobody handed the programme.
describe('the draft pass and a record nobody handed the programme', () => {
    const PLAN = { beats: [{ ordinal: 0, speaker: 0, words: 12 }] } as never;
    const CAST = [{ role: 'host', name: 'Garth', personaKey: 'garth' }] as never;
    const INVENTED = 'The drums are mayhem and I am air-drumming so hard right now. Blue Monday by New Order.';
    const CLEAN = 'The drums are mayhem and I am air-drumming so hard right now, Wayne. It is scary.';

    async function draftWith(answers: (string | Error)[], over: Partial<Production> = {}) {
        let at = 0;
        const converse = vi.fn(async (_request: { messages: { content: string }[] }) => {
            const answer = answers[Math.min(at++, answers.length - 1)]!;
            if (answer instanceof Error) throw answer;
            return { text: answer, finishReason: 'stop' };
        });
        const plan = vi.fn(async (input: { script: string }) => ({ id: 'seg-1', ...input }));
        const productions = {
            claim: vi.fn(async () => production({ state: 'drafting', writingMode: 'outlined', plan: PLAN, casting: CAST, ...over })),
            isCancelled: vi.fn(async () => false),
            moveTo: vi.fn(async () => true),
        } as never;
        const config = { get: (_key: string, fallback: unknown) => fallback } as unknown as AppConfig;

        const job = new ProduceProductionJob(
            productions,
            { plan } as never,
            { recordAll: vi.fn(async () => {}) } as never,
            { presenting: vi.fn(async () => undefined), find: vi.fn(async () => undefined) } as never,
            { onSet: vi.fn(async () => []), named: vi.fn(async () => undefined), markUsed: vi.fn(async () => {}) } as never,
            { forPrompt: vi.fn(async () => []), markUsed: vi.fn(async () => {}) } as never,
            { forPrompt: vi.fn(async () => undefined) } as never,
            { record: vi.fn(async () => {}) } as never,
            {} as never,
            { cues: vi.fn(async () => []) } as never,
            { converse } as never,
            {} as never,
            config,
            { record: vi.fn(async () => {}) } as never,
            {} as never,
            {} as never,
            { id: 'job-1' } as never,
            {} as never,
            logger as never,
        );

        const draft = (job as unknown as { draft: (input: Production) => Promise<boolean> }).draft.bind(job);
        await draft(production({ state: 'drafting' }));

        return { converse, written: plan.mock.calls.map(([input]) => input.script) };
    }

    it('asks again with the record named in the correction, and keeps the rewrite', async () => {
        const { converse, written } = await draftWith([INVENTED, CLEAN]);

        expect(converse).toHaveBeenCalledTimes(2);
        expect(String(converse.mock.calls[1]?.[0].messages[1]?.content)).toContain('names "Blue Monday by New Order", a record you were not given');
        expect(written).toEqual([CLEAN]);
    });

    it('asks once for a beat that names nothing', async () => {
        const { converse, written } = await draftWith([CLEAN]);

        expect(converse).toHaveBeenCalledTimes(1);
        expect(written).toEqual([CLEAN]);
    });

    it('leaves a record the programme was handed alone', async () => {
        const { converse } = await draftWith([INVENTED], { brief: 'why Blue Monday still fills a floor' });

        expect(converse).toHaveBeenCalledTimes(1);
    });

    // A co-host answering the lead may open with a reaction to them, which is the turn the beat prompt
    // asked for; the same words in the lead's opening turn, which answers nobody, are asked again.
    it("lets a co-host's reaction to the lead through, and not the lead's own", async () => {
        const banter = {
            plan: {
                beats: [
                    { ordinal: 0, speaker: 0, words: 12 },
                    { ordinal: 1, speaker: 1, words: 12 },
                ],
            } as never,
            casting: [
                { role: 'host', name: 'Wayne', personaKey: 'wayne' },
                { role: 'cohost', name: 'Garth', personaKey: 'garth' },
            ] as never,
        };
        const REACTION = 'That was so close, Wayne. I am scared of that producer and I do not like change at all.';

        const replied = await draftWith([CLEAN, REACTION], banter);
        expect(replied.converse).toHaveBeenCalledTimes(2);
        expect(replied.written).toEqual([CLEAN, REACTION]);

        const opened = await draftWith([REACTION, CLEAN, CLEAN], banter);
        expect(opened.converse).toHaveBeenCalledTimes(3);
        expect(String(opened.converse.mock.calls[1]?.[0].messages[1]?.content)).toContain('as if a record had just played');
    });

    // The check pass's own terms: a re-draft that fails leaves the first attempt in place rather than
    // a hole, since a programme cannot air with a beat missing.
    it('keeps the first attempt when the re-draft comes back empty or throws', async () => {
        expect((await draftWith([INVENTED, ''])).written).toEqual([INVENTED]);
        expect((await draftWith([INVENTED, new Error('the provider fell over')])).written).toEqual([INVENTED]);
    });
});
