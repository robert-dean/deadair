// Everything here is a way the model can be unhelpful without being broken: off, absent, silent,
// repetitive, or answering confidently without ever having looked at the library. None of them may
// cost the station a running order, because the chain tops up from a draw that cannot fail -- so
// what is actually under test is that each one produces FEWER picks rather than an exception.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import { writeCapture } from '../../../src/modules/llm/llm.capture.js';
import type { StationTaste, TasteRepository } from '../../../src/modules/catalog/taste.repository.js';
import type { TracksRepository } from '../../../src/modules/catalog/tracks.repository.js';
import type { LlmConversation, LlmService } from '../../../src/modules/llm/llm.service.js';
import {
    DEFAULT_MAX_OUTPUT_TOKENS,
    MODEL_GENERATOR_KEYS,
    ModelSetGenerator,
    STYLES_SHOWN,
    maxOutputTokens,
} from '../../../src/modules/director/model.set.generator.js';
import { RefillPreemption } from '../../../src/modules/director/refill.preemption.js';
import { QueuedRecords } from '../../../src/modules/shared/queued.records.js';
import { SearchedRecords } from '../../../src/modules/shared/searched.records.js';
import { DEFAULT_RULES } from '../../../src/modules/director/rotation.rules.js';
import type { SetInputs } from '../../../src/modules/director/set.generator.js';

// Mocked, because what it writes is a file and this is about WHETHER it is asked to.
vi.mock('../../../src/modules/llm/llm.capture.js', () => ({ writeCapture: vi.fn(async () => '/logs/captures/set-x.json') }));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

interface Options {
    /** Whether `llm.setGenerator` is on. Off is the default, as it is in the registry. */
    enabled?: boolean;
    /** Whether a plugin can produce words at all. */
    canGenerate?: boolean;
    /** What the model answers with. */
    text?: string;
    /** How many tool calls the loop ran. */
    toolCallsMade?: number;
    /** A model that throws instead of answering. */
    fails?: boolean;
    /** Why the model stopped. `length` is a run that used all its room before finishing. */
    finishReason?: LlmConversation['finishReason'];
    settings?: Record<string, string>;
    /** What the operator has rated. Absent is a station nobody has said anything about. */
    taste?: Partial<StationTaste>;
    /** A catalog that cannot answer what the operator likes. */
    tasteFails?: boolean;
    /** The styles the library answers to, commonest first. Absent is a catalog nothing enriched. */
    styles?: { style: string; records: number }[];
    /** A catalog that cannot answer which styles it holds. */
    stylesFail?: boolean;
    /** What the model was shown, for the capture switch. */
    transcript?: LlmConversation['transcript'];
    /** What the search tool handed the model, which a failed run falls back to. */
    searched?: { title: string; artist: string }[];
}

/** An empty side of the operator's taste: nothing said, and nothing hidden behind a limit. */
const nothing = <T>(): { shown: T[]; total: number } => ({ shown: [], total: 0 });

function build(options: Options = {}) {
    const converse = vi.fn(async (): Promise<LlmConversation> => {
        if (options.fails) throw new Error('the model host is down');
        return {
            text: options.text ?? '[]',
            toolCalls: [],
            // Resolved by the host rather than echoed from the request, which is what a real
            // conversation answers with even when nothing named a model. See `LlmConversation.model`.
            model: 'a-model',
            toolCallsMade: options.toolCallsMade ?? 1,
            finishReason: options.finishReason ?? 'stop',
            usage: { totalTokens: 500 },
            transcript: options.transcript ?? [],
        };
    });

    const llm = {
        converse,
        canGenerate: () => options.canGenerate ?? true,
        explainGenerator: () => 'no active plugin can produce words',
    } as unknown as LlmService;

    const values: Record<string, string> = {
        [MODEL_GENERATOR_KEYS.enabled]: options.enabled ? 'true' : 'false',
        ...options.settings,
    };
    // Hands back the RAW string, because that is what `AppConfigSourcePostgres` puts in the
    // snapshot. This double used to coerce a boolean itself — `value !== 'false'` — which made it
    // strictly more capable than the thing it stood for and hid a real bug for as long as it
    // existed: production read `'false'` as truthy, so `llm.setGenerator` could not be switched
    // off, and every test here passed because the fake quietly fixed it.
    const config = {
        get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback),
        has: (key: string) => values[key] !== undefined,
    } as unknown as AppConfig;

    const taste = {
        taste: vi.fn(async (): Promise<StationTaste> => {
            if (options.tasteFails) throw new Error('the pool is gone');
            return {
                likedArtists: nothing(),
                dislikedArtists: nothing(),
                likedAlbums: nothing(),
                dislikedAlbums: nothing(),
                likedTracks: nothing(),
                dislikedTracks: nothing(),
                ...options.taste,
            };
        }),
    } as unknown as TasteRepository;

    const styleVocabulary = vi.fn(async (): Promise<{ style: string; records: number }[]> => {
        if (options.stylesFail) throw new Error('the pool is gone');
        return options.styles ?? [];
    });
    const tracks = { styleVocabulary } as unknown as TracksRepository;
    const preemption = new RefillPreemption();

    const queued = new QueuedRecords();
    // What the search tool would have written during the conversation. Seeded directly here: this
    // suite drives `converse` through a double, so no tool ever runs.
    const searched = new SearchedRecords();
    if (options.searched !== undefined) searched.remember(options.searched);

    return {
        generator: new ModelSetGenerator(llm, taste, tracks, preemption, queued, searched, config, logger),
        converse,
        taste,
        styleVocabulary,
        preemption,
        queued,
        searched,
    };
}

const inputs = (count: number, overrides: Partial<SetInputs> = {}): SetInputs => ({ count, rules: DEFAULT_RULES, ...overrides });

const picks = (...pairs: [string, string][]) => JSON.stringify(pairs.map(([title, artist]) => ({ title, artist })));

describe('ModelSetGenerator', () => {
    it('names itself so the log can say which binding chose', () => {
        expect(build().generator.name).toBe('model');
    });

    it('declines without touching the plugin while the setting is off', async () => {
        // Off by default, and this is the state every fresh install is in.
        const { generator, converse } = build({ enabled: false });

        expect(await generator.generate(inputs(10))).toEqual([]);
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when nothing can produce words, which is an ordinary state', async () => {
        const { generator, converse } = build({ enabled: true, canGenerate: false });

        expect(await generator.generate(inputs(10))).toEqual([]);
        expect(converse).not.toHaveBeenCalled();
    });

    it('asks nobody for nothing', async () => {
        const { generator, converse } = build({ enabled: true });

        expect(await generator.generate(inputs(0))).toEqual([]);
        expect(converse).not.toHaveBeenCalled();
    });

    it('turns the model’s answer into picks', async () => {
        const { generator } = build({ enabled: true, text: picks(['Windowlicker', 'Aphex Twin'], ['Teardrop', 'Massive Attack']) });

        expect(await generator.generate(inputs(10))).toEqual([
            { title: 'Windowlicker', artist: 'Aphex Twin' },
            { title: 'Teardrop', artist: 'Massive Attack' },
        ]);
    });

    it('hands back fewer than asked rather than padding', async () => {
        // A partial answer is a good answer here: the chain keeps these and asks the floor for the
        // rest, which is the whole reason a set is not a break.
        const { generator } = build({ enabled: true, text: picks(['A', 'One'], ['B', 'Two']) });

        expect(await generator.generate(inputs(15))).toHaveLength(2);
    });

    it('never hands back more than asked', async () => {
        const { generator } = build({ enabled: true, text: picks(['A', 'One'], ['B', 'Two'], ['C', 'Three']) });

        expect(await generator.generate(inputs(2))).toHaveLength(2);
    });

    it('re-picks rather than drops when the model put one artist on its own heels', async () => {
        // A reorder and never a drop: the model chose these records, and losing one over its
        // neighbour's sake costs the station a track for something a swap fixes.
        const { generator } = build({
            enabled: true,
            text: picks(['A', 'One'], ['B', 'One'], ['C', 'Two']),
        });

        const chosen = await generator.generate(inputs(10));

        expect(chosen).toHaveLength(3);
        expect(chosen.map(pick => pick.artist)).toEqual(['One', 'Two', 'One']);
    });

    it('leaves an all-one-artist answer alone rather than stalling over it', async () => {
        const { generator } = build({ enabled: true, text: picks(['A', 'One'], ['B', 'One']) });

        expect(await generator.generate(inputs(10))).toHaveLength(2);
    });

    it('shows the model what the lineup already holds, as prose rather than as keys', async () => {
        const { generator, converse } = build({ enabled: true });

        await generator.generate(inputs(5, { avoidSongKeys: new Set(['aphex twin:windowlicker']) }));

        const [request] = converse.mock.calls[0] as unknown as [{ messages: { role: string; content: string }[] }];
        const user = request.messages.find(message => message.role === 'user')?.content ?? '';
        expect(user).toMatch(/"windowlicker" by aphex twin/);
    });

    it('skips an avoid key it cannot split rather than showing it mangled', async () => {
        // It would still be a real record in the model's context that no tool returned, which is
        // the one thing the prompt is shaped to avoid.
        const { generator, converse } = build({ enabled: true });

        await generator.generate(inputs(5, { avoidSongKeys: new Set(['nocolonhere', ':leadingcolon', 'trailing:']) }));

        const [request] = converse.mock.calls[0] as unknown as [{ messages: { role: string; content: string }[] }];
        const user = request.messages.find(message => message.role === 'user')?.content ?? '';
        expect(user).not.toMatch(/nocolonhere/);
        expect(user).not.toMatch(/leadingcolon/);
        expect(user).not.toMatch(/trailing/);
    });

    it('carries the operator’s brief into the turn about this refill', async () => {
        const { generator, converse } = build({ enabled: true });

        await generator.generate(inputs(5, { brief: 'heavy metal hits' }));

        const [request] = converse.mock.calls[0] as unknown as [{ messages: { role: string; content: string }[] }];
        expect(request.messages.find(message => message.role === 'user')?.content ?? '').toMatch(/heavy metal hits/);
    });

    it('shows the model what the operator likes and dislikes', async () => {
        const { generator, converse } = build({
            enabled: true,
            taste: {
                likedArtists: { shown: [{ name: 'Sleep' }], total: 1 },
                dislikedArtists: { shown: [{ name: 'Nickelback' }], total: 1 },
                dislikedTracks: { shown: [{ title: 'Photograph', artist: 'Nickelback' }], total: 1 },
            },
        });

        await generator.generate(inputs(5));

        const [request] = converse.mock.calls[0] as unknown as [{ messages: { role: string; content: string }[] }];
        const system = request.messages.find(message => message.role === 'system')?.content ?? '';
        expect(system).toMatch(/Sleep/);
        expect(system).toMatch(/Nickelback/);
        expect(system).toMatch(/Photograph/);
    });

    it('reads the taste on every refill, so an opinion counts on the next hour', async () => {
        // Read rather than held, like every setting here. An operator who likes a record now does
        // not expect to restart the station for it to matter.
        const { generator, taste } = build({ enabled: true });

        await generator.generate(inputs(5));
        await generator.generate(inputs(5));

        expect(taste.taste).toHaveBeenCalledTimes(2);
    });

    it('programmes without the taste rather than failing when the catalog cannot answer', async () => {
        // Steering only. The dislikes are enforced at resolution from the ratings as they stand, so
        // losing this list costs a duller set and can never air something the operator forbade.
        const { generator } = build({ enabled: true, tasteFails: true, text: '[{"title":"One","artist":"A"}]' });

        expect(await generator.generate(inputs(5))).toHaveLength(1);
    });

    it('shows the model which styles the library actually answers to', async () => {
        // The failure this closes: told a brief is a style rather than a search term, and never told
        // which style words exist, the model searched the operator's own four words. `heavy metal
        // hits` matched nothing over a library holding 240 metal records, and the empty answer read
        // as an empty library.
        const { generator, converse } = build({
            enabled: true,
            styles: [
                { style: 'heavy metal', records: 240 },
                { style: 'thrash metal', records: 95 },
            ],
        });

        await generator.generate(inputs(5));

        const [request] = converse.mock.calls[0] as unknown as [{ messages: { role: string; content: string }[] }];
        const system = request.messages.find(message => message.role === 'system')?.content ?? '';
        expect(system).toMatch(/heavy metal \(240\), thrash metal \(95\)/);
        expect(system).toMatch(/The commonest styles this library holds are listed at the end/);
    });

    it('does not accuse the model of idling when the station took the model off it', async () => {
        // A `classic banjo` refill was preempted 4.6 seconds in and reported as `finish=length
        // searches=0`, over which this binding printed "the model chose nothing and never searched
        // the library; it is not using its tools". The model had ASKED to search and been cut off:
        // the abort branch is only reachable from a step that produced tool calls, so 0 searches
        // there is the station's doing. Yielding to a break is what this binding is FOR.
        const { generator } = build({ enabled: true, toolCallsMade: 0, finishReason: 'preempted', text: '' });

        expect(await generator.generate(inputs(5))).toEqual([]);
        expect(logger.warn).not.toHaveBeenCalledWith(expect.stringContaining('not using its tools'));
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('a break took the model back'), expect.anything());
    });

    it('does not tell the operator to raise the ceiling when the station took the model off it', async () => {
        // The other half of the same correction. This used to need a guard, because a preempted
        // call reported `length` — from the provider's side, being cut off and running out of
        // allowance are one thing — so this fired "the model ran out of room ... limit=12000
        // setting=llm.setMaxTokens" over a refill nowhere near the ceiling, 18ms before the line
        // saying a break had taken the model. Measured on 19 August, where the run had used about
        // 290 of the 12,000 tokens it was accused of exhausting. The guard is gone now and the test
        // is not: `'length'` means the ceiling because nothing else answers it any more, and this
        // is what would notice if something started to again.
        vi.mocked(logger.warn).mockClear();
        const { generator } = build({ enabled: true, toolCallsMade: 0, finishReason: 'preempted', text: '' });

        await generator.generate(inputs(5));

        expect(logger.warn).not.toHaveBeenCalledWith(expect.stringMatching(/ran out of room/), expect.anything());
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('a break took the model back'), expect.anything());
    });

    it('asks for another go when a break took the model back', async () => {
        // The signal the job reads to plan again. It travels beside the picks rather than in them
        // because every generator in the chain answers the same shape and only this one can be
        // preempted -- see `RefillPreemption`.
        const { generator, preemption } = build({ enabled: true, toolCallsMade: 0, finishReason: 'preempted', text: '' });

        await generator.generate(inputs(5));

        expect(preemption.took()).toBe(true);
    });

    it('asks for nothing when the model simply had nothing to say', async () => {
        // The distinction the retry rests on: a model that searched and found nothing has ANSWERED,
        // and asking it again would produce the same answer at twice the cost.
        const { generator, preemption } = build({ enabled: true, toolCallsMade: 3, text: '[]' });

        await generator.generate(inputs(5));

        expect(preemption.took()).toBe(false);
    });

    it('still names an idle model when nothing preempted it', async () => {
        // The other side of the same line: a model that had the whole budget, never searched and
        // answered anyway IS failing to drive what it was given, and it will do it again.
        const { generator } = build({ enabled: true, toolCallsMade: 0, text: '' });

        await generator.generate(inputs(5));

        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('not using its tools'));
    });

    it('shows a style the brief asked for however rare it is, and puts it first', async () => {
        // The whole argument, from one live refill. Shown the commonest forty with no jazz among
        // them, a model briefed `jazz club bangers` answered "No style listed. Probably none in
        // library. So cannot find", named nothing and made no tool call -- over a library holding
        // 30 jazz records under a style ranked 49th of 762. Popularity says what the station plays
        // most; the brief says what it is being asked for tonight, and only the second is the
        // question this list exists to answer.
        const styles = [
            ...Array.from({ length: STYLES_SHOWN }, (_, index) => ({ style: `common-${index}`, records: 500 - index })),
            { style: 'jazz', records: 23 },
        ];
        const { generator, converse } = build({ enabled: true, styles });

        await generator.generate(inputs(5, { brief: 'jazz club bangers' }));

        const [request] = converse.mock.calls[0] as unknown as [{ messages: { role: string; content: string }[] }];
        const system = request.messages.find(message => message.role === 'system')?.content ?? '';
        expect(system).toMatch(/jazz \(23\)/);
        // In front of the common ones: the last place a rare style the operator asked for should sit
        // is at the end of a list of forty, where a model reading for the gist will not reach it.
        expect(system.indexOf('jazz (23)')).toBeLessThan(system.indexOf('common-0'));
    });

    it('counts the whole vocabulary rather than the part it showed', async () => {
        // The prompt's claim is about the LIBRARY, so the remainder has to come off everything the
        // library holds. A list truncated without saying so is what cost the refill above.
        const styles = Array.from({ length: STYLES_SHOWN + 12 }, (_, index) => ({ style: `s-${index}`, records: 100 - index }));
        const { generator, converse } = build({ enabled: true, styles });

        await generator.generate(inputs(5));

        const [request] = converse.mock.calls[0] as unknown as [{ messages: { role: string; content: string }[] }];
        const system = request.messages.find(message => message.role === 'system')?.content ?? '';
        expect(system).toMatch(/The library holds 12 more styles than these/);
    });

    it('does not show a style twice when the brief names a common one', async () => {
        const { generator, converse } = build({ enabled: true, styles: [{ style: 'heavy metal', records: 240 }] });

        await generator.generate(inputs(5, { brief: 'heavy metal hits' }));

        const [request] = converse.mock.calls[0] as unknown as [{ messages: { role: string; content: string }[] }];
        const system = request.messages.find(message => message.role === 'system')?.content ?? '';
        expect(system.match(/heavy metal \(240\)/g)).toHaveLength(1);
    });

    it('says nothing about styles when nothing has enriched the catalog', async () => {
        // An ordinary state rather than a fault, and pointing at a list that is not there is worse
        // than saying nothing: the rule promises a vocabulary the prompt would not be carrying.
        const { generator, converse } = build({ enabled: true, styles: [] });

        await generator.generate(inputs(5));

        const [request] = converse.mock.calls[0] as unknown as [{ messages: { role: string; content: string }[] }];
        const system = request.messages.find(message => message.role === 'system')?.content ?? '';
        expect(system).not.toMatch(/The library answers to these styles/);
        expect(system).not.toMatch(/listed at the end of this message/);
    });

    it('reads the styles on every refill, so a newly enriched record can be programmed', async () => {
        // The vocabulary moves as the enrichment pass reaches records, which is a stronger version
        // of the argument for reading the taste per refill.
        const { generator, styleVocabulary } = build({ enabled: true });

        await generator.generate(inputs(5));
        await generator.generate(inputs(5));

        expect(styleVocabulary).toHaveBeenCalledTimes(2);
    });

    it('programmes without the styles rather than failing when the catalog cannot answer', async () => {
        // Same trade as the taste: this makes a search better and enforces nothing, so a read that
        // threw costs the steering and never the set.
        const { generator } = build({ enabled: true, stylesFail: true, text: '[{"title":"One","artist":"A"}]' });

        expect(await generator.generate(inputs(5))).toHaveLength(1);
    });

    it('bounds both the wait and the generation, so a refill cannot starve the breaks', async () => {
        const { generator, converse } = build({ enabled: true });

        await generator.generate(inputs(5));

        const [, options] = converse.mock.calls[0] as unknown as [unknown, { budgetMs: number; maxWaitMs: number; maxToolSteps: number }];
        expect(options.budgetMs).toBe(180_000);
        expect(options.maxWaitMs).toBe(60_000);
        expect(options.maxToolSteps).toBe(5);
    });

    it('passes the operator’s chosen model through, and omits it when there is none', async () => {
        const chosen = build({ enabled: true, settings: { [MODEL_GENERATOR_KEYS.model]: 'big-model' } });
        await chosen.generator.generate(inputs(5));
        expect((chosen.converse.mock.calls[0] as unknown as [{ model?: string }])[0].model).toBe('big-model');

        const bare = build({ enabled: true });
        await bare.generator.generate(inputs(5));
        expect((bare.converse.mock.calls[0] as unknown as [{ model?: string }])[0]).not.toHaveProperty('model');
    });

    it('tells a model that never searched apart from one that searched and came back empty', async () => {
        // The breaker distinction, and the two need different fixes: "not using its tools" is the
        // model failing, while an empty answer after real searching is a thin library or an answer
        // arriving in a shape nothing could read. One warning covering both would hide whichever
        // was actually happening.
        vi.mocked(logger.warn).mockClear();
        const lazy = build({ enabled: true, text: '[]', toolCallsMade: 0 });
        await lazy.generator.generate(inputs(5));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/never searched/));

        vi.mocked(logger.warn).mockClear();
        const searched = build({ enabled: true, text: '[]', toolCallsMade: 3 });
        await searched.generator.generate(inputs(5));
        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/named no records/), expect.anything());
        expect(logger.warn).not.toHaveBeenCalledWith(expect.stringMatching(/never searched/));
    });

    it('quotes what it could not read, because an empty answer is otherwise undiagnosable', async () => {
        // A model that found nothing, one that answered in prose and one that spent its whole
        // allowance thinking are the same empty list from here. This live-diagnosed the difference
        // between the first two on the station's own host.
        vi.mocked(logger.warn).mockClear();
        const { generator } = build({ enabled: true, text: 'I had a really good think about this.', toolCallsMade: 2 });

        await generator.generate(inputs(5));

        expect(logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ said: 'I had a really good think about this.' }));
    });

    it('says nothing at all when the model actually chose records', async () => {
        vi.mocked(logger.warn).mockClear();
        const { generator } = build({ enabled: true, text: picks(['A', 'One']), toolCallsMade: 2 });

        await generator.generate(inputs(5));

        expect(logger.warn).not.toHaveBeenCalled();
    });

    it('says so when the model ran out of room before it finished answering', async () => {
        // The one failure here that looks exactly like a model with nothing to say. It cost a live
        // run eleven jazz records and was diagnosable only by noticing that the two it did name were
        // spelled like fragments of JSON.
        vi.mocked(logger.warn).mockClear();
        const { generator } = build({ enabled: true, text: picks(['A', 'One']), toolCallsMade: 2, finishReason: 'length' });

        await generator.generate(inputs(5));

        expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/ran out of room/), expect.objectContaining({ named: 1 }));
    });

    it('keeps what the model was shown and what it said while capture is on', async () => {
        // The gap this closes. A model that searched three times, was handed thirty-six records and
        // then answered `[]` left a 400-character log line behind it, and "it found nothing", "it
        // answered in prose" and "its answer went somewhere this does not read" are three different
        // fixes that look identical from there.
        const { generator } = build({
            enabled: true,
            settings: { 'llm.captureWrites': 'true' },
            text: '[]',
            toolCallsMade: 3,
            transcript: [
                { role: 'user', content: 'Choose 5 records.' },
                { role: 'tool', toolCallId: 'call_1', content: '[{"title":"Atrophy"}]' },
            ],
        });

        await generator.generate(inputs(5));

        expect(writeCapture).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({
                kind: 'set',
                answer: '[]',
                transcript: expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining('Atrophy') })]),
                context: expect.objectContaining({ named: 0, searches: 3 }),
            }),
            expect.any(Number),
        );
    });

    it('writes a preempted run into the capture as preempted, not as length', async () => {
        // The whole point of the reason carrying it. `writeCapture` records `finish` and nothing
        // beside it, so for as long as a preemption reported `length` the on-disk record of one was
        // indistinguishable from a model that ran out of room — and the capture is where a
        // zero-pick run is actually read. Measured 2026-08-28: all ten empty captures on this
        // install say `length`, both that could still be traced to a log line were preemptions, and
        // `DEFAULT_MAX_OUTPUT_TOKENS` had been doubled twice arguing from that shape.
        vi.mocked(writeCapture).mockClear();
        const { generator } = build({
            enabled: true,
            settings: { 'llm.captureWrites': 'true' },
            text: '',
            toolCallsMade: 0,
            finishReason: 'preempted',
        });

        await generator.generate(inputs(5));

        expect(writeCapture).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ context: expect.objectContaining({ finish: 'preempted', named: 0 }) }),
            expect.any(Number),
        );
    });

    it('keeps nothing while the switch is off, which is every ordinary night', async () => {
        vi.mocked(writeCapture).mockClear();
        const { generator } = build({ enabled: true, text: picks(['A', 'One']) });

        await generator.generate(inputs(5));

        expect(writeCapture).not.toHaveBeenCalled();
    });

    it('lets a model failure reach the chain, which is what absorbs it', async () => {
        // Not caught here. `SetGeneratorChain.ask` flattens every way of failing to "it named
        // nothing" in one place, so a second generator does not reimplement the same catch.
        const { generator } = build({ enabled: true, fails: true });

        await expect(generator.generate(inputs(5))).rejects.toThrow(/model host is down/);
    });
});

// The records were found, filtered and handed over; the only thing missing was the sentence naming
// which of them to play, and that sentence is the least reliable part of the exchange. A station
// asked for "Artists like Mitch murder" opened with thirteen thrash records with ten synthwave ones
// sitting in the conversation that had just failed.
describe('when the model goes quiet, what its searches found', () => {
    const found = [
        { title: 'Miami Nights', artist: 'Mitch Murder' },
        { title: 'Accelerated', artist: 'Lost Years' },
        { title: 'Nightcall', artist: 'Kavinsky' },
    ];

    it('fills the hour when the conversation throws', async () => {
        const { generator } = build({ enabled: true, fails: true, searched: found });

        await expect(generator.generate(inputs(5))).resolves.toEqual([
            { title: 'Miami Nights', artist: 'Mitch Murder' },
            { title: 'Accelerated', artist: 'Lost Years' },
            { title: 'Nightcall', artist: 'Kavinsky' },
        ]);
    });

    it('fills the hour when the model answers with nothing this can read', async () => {
        const { generator } = build({ enabled: true, text: '', toolCallsMade: 4, finishReason: 'stop', searched: found });

        const picked = await generator.generate(inputs(5));

        expect(picked.map(pick => pick.artist)).toEqual(['Mitch Murder', 'Lost Years', 'Kavinsky']);
    });

    it('never names more than it was asked for', async () => {
        const { generator } = build({ enabled: true, text: '', toolCallsMade: 4, finishReason: 'stop', searched: found });

        expect(await generator.generate(inputs(2))).toHaveLength(2);
    });

    it('leaves a PREEMPTED refill alone, because that one is owed a retry', async () => {
        // A retry against a model the station interrupted is better than the leftovers of one
        // search, and `RefillPreemption` is what asks for it. Rescuing here would spend the slot
        // that retry was going to use and hide the interruption behind an answer.
        const { generator, preemption } = build({
            enabled: true,
            text: '',
            toolCallsMade: 2,
            finishReason: 'preempted',
            searched: found,
        });

        expect(await generator.generate(inputs(5))).toEqual([]);
        expect(preemption.took()).toBe(true);
    });

    it('still lets a failure through when nothing was searched', async () => {
        // A refill that died before its first search has nothing to rescue, and the chain's own
        // reporting is the right thing to reach.
        const { generator } = build({ enabled: true, fails: true });

        await expect(generator.generate(inputs(5))).rejects.toThrow(/model host is down/);
    });
});

describe('maxOutputTokens', () => {
    const config = (rows: Record<string, unknown>): AppConfig =>
        ({ get: (key: string, fallback: unknown) => rows[key] ?? fallback }) as unknown as AppConfig;

    it('reads the operator’s ceiling as the string the settings table stores', () => {
        // The whole point of the knob: read as a number this arrives as `"24000"` and every value
        // the operator ever typed falls silently back to the default.
        expect(maxOutputTokens(config({ 'llm.setMaxTokens': '24000' }))).toBe(24_000);
        expect(maxOutputTokens(config({ 'llm.setMaxTokens': 24_000 }))).toBe(24_000);
    });

    it('falls back rather than sending a provider something it will reject', () => {
        // Clamped rather than rejected, on `resolveAnalysisConcurrency`'s argument: a setting that
        // refuses to load stops the refill entirely, which is worse than an unexpected ceiling.
        expect(maxOutputTokens(config({ 'llm.setMaxTokens': 'lots' }))).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
        expect(maxOutputTokens(config({ 'llm.setMaxTokens': '0' }))).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
        expect(maxOutputTokens(config({ 'llm.setMaxTokens': '-5' }))).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });

    it('uses its own default when the operator has said nothing', () => {
        expect(maxOutputTokens(config({}))).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });
});
