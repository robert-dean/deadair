// The skeleton every model break writer shares. What each KIND does with it is tested beside that
// writer; what is here is the part that has to be the same for all of them: when the model is not
// asked at all, the bounds it is asked under, the guard's common half, and what reaches the record
// when the answer is refused or cut.

import { describe, expect, it, vi } from 'vitest';

import type { AppConfig } from '@maroonedsoftware/appconfig';
import type { Logger } from '@maroonedsoftware/logger';
import type { LlmMessage } from '@deadair/plugin-sdk';
import type { LlmService } from '../../../src/modules/llm/llm.service.js';
import { writeWithModel, type ModelWriteAsk } from '../../../src/modules/director/model.break.write.js';
import { BUDGET_MS, MODEL_WRITER_KEYS } from '../../../src/modules/director/model.talk.break.writer.js';
import { TALK_BREAK_SHAPE, type AnswerGuard } from '../../../src/modules/director/break.prompt.js';
import { TALK_BREAK_KIND } from '../../../src/modules/director/talk.break.writer.js';

const next = { title: 'Pink Moon', artist: 'Nick Drake' };

function build(options: { values?: Record<string, unknown>; answer?: string; finish?: string; canGenerate?: boolean } = {}) {
    const values: Record<string, unknown> = { [MODEL_WRITER_KEYS.enabled]: 'true', ...options.values };

    const converse = vi.fn(async (_asked: { messages: LlmMessage[] }, _options?: Record<string, unknown>) => ({
        text: options.answer ?? 'Coming up, Pink Moon by Nick Drake.',
        toolCalls: [],
        model: 'test:model',
        finishReason: options.finish ?? 'stop',
    }));

    const llm = {
        canGenerate: () => options.canGenerate ?? true,
        explainGenerator: () => 'no active plugin can produce words',
        converse,
    } as unknown as LlmService;

    const config = { get: (key: string, fallback: unknown) => (key in values ? values[key] : fallback) } as unknown as AppConfig;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

    return { host: { llm, config, logger }, converse, logger };
}

const ask = (overrides: Partial<ModelWriteAsk> = {}): ModelWriteAsk => ({
    request: { kind: TALK_BREAK_KIND, next, station: 'Deadair' },
    settings: { station: 'Deadair' },
    shape: TALK_BREAK_SHAPE,
    guard: () => ({}),
    purpose: { noModel: 'write with', nothing: 'say' },
    ...overrides,
});

describe('writeWithModel', () => {
    it('asks nothing while the model writer is off, and records nothing', async () => {
        const { host, converse } = build({ values: { [MODEL_WRITER_KEYS.enabled]: 'false' } });

        expect(await writeWithModel(host, ask())).toEqual({});
        expect(converse).not.toHaveBeenCalled();
    });

    it('asks nothing when no model can generate, and says so only at debug', async () => {
        const { host, converse, logger } = build({ canGenerate: false });

        expect(await writeWithModel(host, ask())).toEqual({});
        expect(converse).not.toHaveBeenCalled();
        expect(vi.mocked(logger.debug).mock.calls[0]?.[0]).toContain('no model to write with');
    });

    it('asks with no tools, inside the break budget, and in the operator order of models', async () => {
        const { host, converse } = build({ values: { [MODEL_WRITER_KEYS.model]: '[{"model":"a:one"},{"model":"b:two"}]' } });

        await writeWithModel(host, ask());

        const [asked, options] = converse.mock.calls[0] ?? [];
        expect(asked).toMatchObject({ model: 'a:one' });
        expect(options).toMatchObject({ tools: false, models: ['a:one', 'b:two'], budgetMs: BUDGET_MS });
    });

    it('hands back the script, the guard it passed and the resolved model', async () => {
        const { host } = build();

        const outcome = await writeWithModel(host, ask());

        expect(outcome.written?.script).toBe('Coming up, Pink Moon by Nick Drake.');
        expect(outcome.detail?.model).toBe('test:model');
    });

    it('builds the guard from the same prompt it sends, with the writer’s own half on top', async () => {
        const { host } = build();
        const seen: LlmMessage[][] = [];
        const extras = (messages: LlmMessage[]): Partial<AnswerGuard> => {
            seen.push(messages);
            return { years: [] };
        };

        const outcome = await writeWithModel(host, ask({ guard: extras }));

        expect(seen).toHaveLength(1);
        expect(outcome.written?.guard.years).toEqual([]);
        expect(outcome.written?.messages).toBe(seen[0]);
    });

    it('excuses the dialect only where the writer asks', async () => {
        const persona = { key: 'plain', name: 'Plain', style: 'plain' } as unknown as NonNullable<ModelWriteAsk['request']['persona']>;
        const { host } = build();

        const strict = await writeWithModel(host, ask({ request: { kind: TALK_BREAK_KIND, next, persona } }));
        const lean = await writeWithModel(host, ask({ request: { kind: TALK_BREAK_KIND, next, persona }, dialect: 'optional' }));

        expect(strict.written?.guard.dialect).toBeUndefined();
        expect(lean.written?.guard.dialect).toBe('optional');
    });

    it('records the reason for a refusal, and the fault only for a kind that is retried', async () => {
        const { host } = build({ answer: '' });

        const plain = await writeWithModel(host, ask());
        const retried = await writeWithModel(host, ask({ retryable: true }));

        expect(plain.written).toBeUndefined();
        expect(plain.detail?.fault).toBeUndefined();
        expect(retried.detail?.fault).toBeDefined();
    });

    it('says when the model thought until it ran out and never spoke', async () => {
        const { host, logger } = build({ answer: '', finish: 'length' });

        await writeWithModel(host, ask());

        expect(vi.mocked(logger.info).mock.calls[0]?.[0]).toContain('thinking');
    });

    it('records a cut on the detail of a break that was written', async () => {
        const long = Array.from({ length: 12 }, (_, i) => `Pink Moon by Nick Drake is lovely, part ${i + 1}.`).join(' ');
        const { host } = build({ answer: long });

        const outcome = await writeWithModel(host, ask());

        expect(outcome.written).toBeDefined();
        expect(outcome.detail?.reason).toBeDefined();
    });
});
