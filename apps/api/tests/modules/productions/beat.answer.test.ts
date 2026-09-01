// A preempted ask and an empty one are not the same thing, and the drafting loop used to read only
// the text. What is pinned here is the difference: a preemption is not an attempt, is not recorded,
// does not spend the empty allowance and is asked again; an empty answer is all three; and when
// either count runs out the reason names which, so a programme the station's own breaks kept
// cutting off is never written up as a model that had nothing to say.

import { describe, expect, it, vi } from 'vitest';

import { EMPTY_BEAT_RETRIES, PREEMPTED_BEAT_RETRIES, askForBeat } from '../../../src/modules/productions/beat.answer.js';

interface Answer {
    text: string;
    finishReason: string;
}

const said = (text: string): Answer => ({ text, finishReason: 'stop' });
const preempted = (): Answer => ({ text: '', finishReason: 'preempted' });

/** Answers in order, then the last one forever. */
const asking = (answers: Answer[]) => {
    let at = 0;
    return vi.fn(async () => answers[Math.min(at++, answers.length - 1)]!);
};

const read = (answer: Answer) => answer.text.trim();

describe('askForBeat', () => {
    it('keeps the first answer with words in it', async () => {
        const ask = asking([said('Good evening.')]);

        const outcome = await askForBeat(ask, read);

        expect(outcome.script).toBe('Good evening.');
        expect(outcome.asked).toHaveLength(1);
        expect(outcome.preempted).toBe(0);
        expect(outcome.reason).toBeUndefined();
    });

    it('asks again after a preemption without counting it as an attempt', async () => {
        const ask = asking([preempted(), said('Good evening.')]);
        const onPreempted = vi.fn();
        const onEmpty = vi.fn();

        const outcome = await askForBeat(ask, read, { onPreempted, onEmpty });

        expect(outcome.script).toBe('Good evening.');
        // Nothing was said, so there is nothing to write down as the model's.
        expect(outcome.asked).toHaveLength(1);
        expect(outcome.preempted).toBe(1);
        expect(onPreempted).toHaveBeenCalledWith(1);
        expect(onEmpty).not.toHaveBeenCalled();
    });

    it('does not let preemptions spend the empty allowance', async () => {
        // Preempted, empty, preempted, empty would have failed the old loop on the first empty's
        // retry. Each count is its own.
        const ask = asking([preempted(), said(''), preempted(), said('At last.')]);

        const outcome = await askForBeat(ask, read);

        expect(outcome.script).toBe('At last.');
        expect(outcome.asked.map(attempt => attempt.script)).toEqual(['', 'At last.']);
        expect(outcome.preempted).toBe(2);
    });

    it('gives up on a beat the breaks keep taking the model back from, and says so', async () => {
        const ask = asking([preempted()]);

        const outcome = await askForBeat(ask, read);

        expect(outcome.script).toBe('');
        expect(outcome.reason).toBe('preempted');
        expect(outcome.preempted).toBe(PREEMPTED_BEAT_RETRIES + 1);
        expect(outcome.asked).toEqual([]);
        expect(ask).toHaveBeenCalledTimes(PREEMPTED_BEAT_RETRIES + 1);
    });

    it('gives up on a beat that comes back empty every time, and records every empty answer', async () => {
        const ask = asking([said('   ')]);
        const onEmpty = vi.fn();

        const outcome = await askForBeat(ask, read, { onEmpty });

        expect(outcome.script).toBe('');
        expect(outcome.reason).toBe('empty');
        expect(outcome.asked).toHaveLength(EMPTY_BEAT_RETRIES + 1);
        expect(onEmpty).toHaveBeenCalledTimes(EMPTY_BEAT_RETRIES);
    });

    it('judges emptiness by what the reader makes of the answer, not by the raw text', async () => {
        // A beat that is nothing but a stage direction is empty once it is made speakable.
        const ask = asking([said('*laughs*'), said('Right then.')]);

        const outcome = await askForBeat(ask, answer => answer.text.replace(/\*[^*]*\*/g, '').trim());

        expect(outcome.script).toBe('Right then.');
        expect(outcome.asked[0]?.script).toBe('');
    });
});
