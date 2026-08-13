// Everything here is a way the model can be unhelpful without being broken: off, absent, silent,
// repetitive, or answering confidently without ever having looked at the library. None of them may
// cost the station a running order, because the chain tops up from a draw that cannot fail -- so
// what is actually under test is that each one produces FEWER picks rather than an exception.

import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';

import type { StationTaste, TasteRepository } from '../../../src/modules/catalog/taste.repository.js';
import type { LlmConversation, LlmService } from '../../../src/modules/llm/llm.service.js';
import { MODEL_GENERATOR_KEYS, ModelSetGenerator } from '../../../src/modules/director/model.set.generator.js';
import { DEFAULT_RULES } from '../../../src/modules/director/rotation.rules.js';
import type { SetInputs } from '../../../src/modules/director/set.generator.js';

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
    settings?: Record<string, string>;
    /** What the operator has rated. Absent is a station nobody has said anything about. */
    taste?: Partial<StationTaste>;
    /** A catalog that cannot answer what the operator likes. */
    tasteFails?: boolean;
}

/** An empty side of the operator's taste: nothing said, and nothing hidden behind a limit. */
const nothing = <T>(): { shown: T[]; total: number } => ({ shown: [], total: 0 });

function build(options: Options = {}) {
    const converse = vi.fn(async (): Promise<LlmConversation> => {
        if (options.fails) throw new Error('the model host is down');
        return {
            text: options.text ?? '[]',
            toolCalls: [],
            toolCallsMade: options.toolCallsMade ?? 1,
            finishReason: 'stop',
            usage: { totalTokens: 500 },
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
    const config = {
        get: (key: string, fallback: unknown) => {
            const value = values[key];
            if (value === undefined) return fallback;
            return typeof fallback === 'boolean' ? value !== 'false' : value;
        },
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

    return { generator: new ModelSetGenerator(llm, taste, config, logger), converse, taste };
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

    it('lets a model failure reach the chain, which is what absorbs it', async () => {
        // Not caught here. `SetGeneratorChain.ask` flattens every way of failing to "it named
        // nothing" in one place, so a second generator does not reimplement the same catch.
        const { generator } = build({ enabled: true, fails: true });

        await expect(generator.generate(inputs(5))).rejects.toThrow(/model host is down/);
    });
});
