// The model binding for a trivia break. Everything here is about what it will not do: pass on
// trivia it was not given, ask a model at all with nothing to say, air an answer naming a year the
// station never looked up, or rest a claim the script did not say.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { LlmMessage } from '@deadair/plugin-sdk';
import type { Logger } from '@maroonedsoftware/logger';

import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import {
    describeTrivia,
    factsUsed,
    ModelTriviaBreakWriter,
    TRIVIA_BREAK_MAX_WORDS,
} from '../../../src/modules/director/model.trivia.break.writer.js';
import { MODEL_WRITER_KEYS } from '../../../src/modules/director/model.talk.break.writer.js';
import { TRIVIA_KIND } from '../../../src/modules/director/trivia.kind.js';
import type { TriviaFact } from '../../../src/modules/director/trivia.source.js';
import type { FactRepository } from '../../../src/modules/enrichment/fact.repository.js';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

const config = (values: Record<string, unknown> = {}): AppConfig =>
    ({ get: vi.fn((key: string, fallback: unknown) => values[key] ?? fallback) }) as unknown as AppConfig;

const enabled = { [MODEL_WRITER_KEYS.enabled]: 'true' };

const TRIVIA: TriviaFact[] = [
    { factId: 'fact-dummy', claim: 'Dummy was recorded in Bath over ten months in 1993.', about: 'Dummy, by Portishead' },
    { factId: 'fact-massive', claim: 'Massive Attack formed in Bristol in 1988.', about: 'Massive Attack' },
];

const request = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({
    kind: TRIVIA_KIND,
    station: 'Deadair',
    trivia: TRIVIA,
    ...overrides,
});

function build(answer: string, values: Record<string, unknown> = enabled) {
    const converse = vi.fn(async (_asked: { messages: LlmMessage[] }, _options?: unknown) => ({
        text: answer,
        finishReason: 'stop',
        usage: { outputTokens: 20 },
    }));
    const llm = { canGenerate: () => true, explainGenerator: () => 'ready', converse } as unknown as LlmService;
    const markUsed = vi.fn(async (_ids: readonly string[]) => {});
    const facts = { markUsed } as unknown as FactRepository;

    return { writer: new ModelTriviaBreakWriter(llm, facts, config(values), logger), converse, markUsed };
}

const systemTurn = (converse: ReturnType<typeof build>['converse']): string =>
    String((converse.mock.calls[0]?.[0].messages ?? []).find(message => message.role === 'system')?.content ?? '');

const userTurn = (converse: ReturnType<typeof build>['converse']): string =>
    String((converse.mock.calls[0]?.[0].messages ?? []).find(message => message.role === 'user')?.content ?? '');

beforeEach(() => vi.clearAllMocks());

describe('when it will not even ask', () => {
    it('declines with no facts, rather than having a model remember some', async () => {
        const { writer, converse } = build('Portishead recorded Dummy in Bath.');

        expect(await writer.write(request({ trivia: undefined }))).toBeUndefined();
        expect(await writer.write(request({ trivia: [] }))).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });

    it('declines when the model writer is switched off with the STRING a settings row stores', async () => {
        const { writer, converse } = build('Portishead recorded Dummy in Bath.', { [MODEL_WRITER_KEYS.enabled]: 'false' });

        expect(await writer.write(request())).toBeUndefined();
        expect(converse).not.toHaveBeenCalled();
    });
});

describe('what the model is shown', () => {
    it('is each fact with what it is about, and told they are not its to add to', async () => {
        const { writer, converse } = build('Portishead recorded Dummy in Bath over ten months. Here is the next one.');

        await writer.write(request());

        expect(userTurn(converse)).toContain('- About Dummy, by Portishead: Dummy was recorded in Bath over ten months in 1993.');
        expect(userTurn(converse)).toContain('not yours to add to');
        expect(systemTurn(converse)).toContain('Pick ONE of the facts');
        expect(systemTurn(converse)).toContain(String(TRIVIA_BREAK_MAX_WORDS));
    });

    it('is not shown the notes on the record coming up, which it would braid into the trivia', async () => {
        const { writer, converse } = build('Portishead recorded Dummy in Bath over ten months.');

        await writer.write(
            request({ next: { title: 'Teardrop', artist: 'Massive Attack', facts: ['Teardrop features Elizabeth Fraser on vocals.'] } }),
        );

        expect(userTurn(converse)).not.toContain('Elizabeth Fraser');
    });

    it('is asked without tools', async () => {
        const { writer, converse } = build('Portishead recorded Dummy in Bath over ten months.');

        await writer.write(request());

        expect(converse.mock.calls[0]?.[1]).toMatchObject({ tools: false });
    });
});

describe('a year nobody looked up', () => {
    it('is refused as invented-year', async () => {
        // The year Dummy was RELEASED, which a model knows and the station was never given.
        const { writer, markUsed } = build('Portishead released Dummy in 1994, after recording it in Bath.');

        expect(await writer.write(request())).toBeUndefined();
        expect(writer.detailOfLastWrite()?.reason).toContain('stated a year the station never gave it');
        expect(markUsed).not.toHaveBeenCalled();
    });

    it('permits a year a fact carries', async () => {
        const { writer } = build('Massive Attack formed in Bristol back in 1988. Here is some more music.');

        expect((await writer.write(request()))?.script).toContain('1988');
    });
});

describe('what it spends', () => {
    it('rests only the fact the script said, and names the break for it', async () => {
        const { writer, markUsed } = build('Here is one: Massive Attack formed in Bristol in 1988. Back to the music.');

        const written = await writer.write(request());

        expect(markUsed).toHaveBeenCalledWith(['fact-massive']);
        expect(written?.label).toBe('Trivia: Massive Attack');
        expect(written?.listenerLabel).toBe('Trivia');
    });

    it('rests nothing when the read-back cannot tell which fact was said', async () => {
        const { writer, markUsed } = build('Here is a little something about the music. Back to it.');

        const written = await writer.write(request());

        expect(written).toBeDefined();
        expect(markUsed).not.toHaveBeenCalled();
        expect(written?.label).toBe('Trivia');
    });

    it('does not count the record coming up as evidence of a fact about the same artist', async () => {
        // A hand-back to Massive Attack names the band whichever fact was passed on.
        const used = factsUsed('Coming up, Massive Attack.', TRIVIA, ['Teardrop', 'Massive Attack']);

        expect(used.map(fact => fact.factId)).not.toContain('fact-massive');
    });
});

describe('describeTrivia', () => {
    it('is one line per fact and nothing of the station’s own wording inside a line', () => {
        const lines = describeTrivia(TRIVIA).split('\n');

        expect(lines.slice(1)).toEqual([
            '- About Dummy, by Portishead: Dummy was recorded in Bath over ten months in 1993.',
            '- About Massive Attack: Massive Attack formed in Bristol in 1988.',
        ]);
    });
});
