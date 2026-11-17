// A show's judge split: the model answers yes or no about a record once, at the lowest priority, and
// "could not place it" is kept as no, since nothing airs on a guess.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import { MIX_JUDGE_VERSION, mixJudgePrompt, readMixJudgement } from '../../../src/modules/director/mix.judge.js';
import { MixJudgeService } from '../../../src/modules/director/mix.judge.service.js';
import { settingsConfig } from '../../utils/settings.config.js';

const logger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) as unknown as Logger;

describe('readMixJudgement', () => {
    it('reads yes, no and could not tell, and nothing else', () => {
        expect(readMixJudgement('{"answer": true}')).toBe(true);
        expect(readMixJudgement('{"answer": false}')).toBe(false);
        expect(readMixJudgement('{"unknown": true}')).toBe('unknown');
        expect(readMixJudgement('{"answer": "yes"}')).toBeUndefined();
    });

    it('puts the record and the question in front of the model', () => {
        const [, user] = mixJudgePrompt({ question: 'a sinful pop hit?', title: 'Toxic', artist: 'Britney Spears' }, false);
        expect(user!.content).toContain('"Toxic" by Britney Spears');
        expect(user!.content).toContain('The question: a sinful pop hit?');
    });
});

function build(answers: unknown[]) {
    const queue = [...answers];
    const judgements = {
        pending: vi.fn(async () => [{ questionKey: 'k', question: 'a sinful pop hit?', trackId: 't1', title: 'Toxic', artist: 'Britney Spears' }]),
        answer: vi.fn(async () => {}),
        recordFailure: vi.fn(async () => {}),
    };
    const llm = { converse: vi.fn(async () => queue.shift()) };
    return {
        judge: new MixJudgeService(judgements as never, llm as never, { hasSearch: () => false } as never, settingsConfig({}).config, logger()),
        judgements,
    };
}

describe('MixJudgeService', () => {
    it('stores the answer, and "could not place it" as no', async () => {
        const yes = build([{ text: '{"answer":true}', finishReason: 'stop' }]);
        expect(await yes.judge.answerPending(10)).toEqual({ answered: 1, failed: 0, yielded: false });
        expect(yes.judgements.answer).toHaveBeenCalledWith('k', 't1', true, MIX_JUDGE_VERSION);

        const unsure = build([{ text: '{"unknown":true}', finishReason: 'stop' }]);
        await unsure.judge.answerPending(10);
        expect(unsure.judgements.answer).toHaveBeenCalledWith('k', 't1', false, MIX_JUDGE_VERSION);
    });

    it('backs off an answer that is not yes or no, and stops when the model is wanted elsewhere', async () => {
        const bad = build([{ text: 'maybe', finishReason: 'stop' }]);
        expect((await bad.judge.answerPending(10)).failed).toBe(1);
        expect(bad.judgements.recordFailure).toHaveBeenCalled();

        const busy = build([{ text: '', finishReason: 'preempted' }]);
        expect((await busy.judge.answerPending(10)).yielded).toBe(true);
        expect(busy.judgements.answer).not.toHaveBeenCalled();
    });
});
