// Which story a break gets, and which part of it. Almost everything worth pinning here is about
// TIMING, because the two failures this function exists to prevent are both invisible on a station
// that is working:
//
//   * two breaks planned before either airs both getting part two, so a listener hears one part
//     twice and never hears the next — which the cadence gap is for;
//   * a part marked as told on the strength of a break that was dropped, so the story skips it for
//     good — which is why eligibility reads AIRED rather than written.

import { describe, expect, it } from 'vitest';

import { nextThread, type ThreadCandidate } from '../../../src/modules/personas/persona.thread.js';

const NOW = Date.UTC(2026, 4, 12, 20, 0);
const GAP = 40 * 60_000;

const anecdote = (id: string, over: Partial<ThreadCandidate> = {}): ThreadCandidate => ({ id, kind: 'anecdote', beats: [], ...over });

const arc = (id: string, beats: { id: string; beat: string; aired: boolean }[], over: Partial<ThreadCandidate> = {}): ThreadCandidate => ({
    id,
    kind: 'arc',
    beats,
    ...over,
});

const part = (id: string, text: string, aired = false) => ({ id, beat: text, aired });

describe('an anecdote', () => {
    it('is taken as it always was, in rotation order', () => {
        expect(nextThread([anecdote('a1'), anecdote('a2')], NOW, GAP)).toEqual({ id: 'a1' });
    });

    it('is not held back by the gap, because the rotation is its whole mechanism', () => {
        // Deliberate: adding a second guard here would change behaviour this feature has no quarrel
        // with, and the rotation already puts a just-told anecdote at the back of the queue.
        expect(nextThread([anecdote('a1', { lastCarriedAt: NOW - 60_000 })], NOW, GAP)).toEqual({ id: 'a1' });
    });
});

describe('an arc', () => {
    it('gives the first part to a story nobody has heard', () => {
        const chosen = nextThread([arc('s1', [part('b1', 'It started with a letter.'), part('b2', 'You read it twice.')])], NOW, GAP);

        expect(chosen).toEqual({ id: 's1', beat: { id: 'b1', text: 'It started with a letter.', last: false } });
    });

    it('gives the next part once the last one has aired, and says where it left off', () => {
        const chosen = nextThread(
            [arc('s1', [part('b1', 'It started with a letter.', true), part('b2', 'You read it twice.')], { lastCarriedAt: NOW - GAP - 1 })],
            NOW,
            GAP,
        );

        // The previous PART's own words, not what the break said about it: approved prose that does
        // not age out of the script history and says what the listener was told rather than how.
        expect(chosen).toEqual({
            id: 's1',
            beat: { id: 'b2', text: 'You read it twice.', leftAt: 'It started with a letter.', last: true },
        });
    });

    it('marks the last part as the last, so it can be landed', () => {
        const chosen = nextThread([arc('s1', [part('b1', 'The only part.')])], NOW, GAP);

        expect(chosen?.beat?.last).toBe(true);
    });

    it('does not advance on a part that was written but never aired', () => {
        // The break was planned and dropped. The part is still owed, and offering the next one would
        // cost a listener an episode nothing will ever offer again.
        const chosen = nextThread(
            [arc('s1', [part('b1', 'It started with a letter.'), part('b2', 'You read it twice.')], { lastCarriedAt: NOW - GAP - 1 })],
            NOW,
            GAP,
        );

        expect(chosen?.beat?.id).toBe('b1');
    });

    it('is passed over while a telling of it is younger than the gap', () => {
        // The double-booking case: a break carrying part one has been written and has not aired, so
        // a second break written in the same window must not be handed part two.
        const chosen = nextThread(
            [arc('s1', [part('b1', 'It started with a letter.'), part('b2', 'You read it twice.')], { lastCarriedAt: NOW - 60_000 }), anecdote('a1')],
            NOW,
            GAP,
        );

        expect(chosen).toEqual({ id: 'a1' });
    });

    it('comes back once the gap has passed, even though nothing aired', () => {
        // The other direction of the same rule: a telling older than the gap that never aired is
        // VOID, so a dropped break gives its part back rather than stalling the arc forever.
        const chosen = nextThread([arc('s1', [part('b1', 'It started with a letter.')], { lastCarriedAt: NOW - GAP - 1 })], NOW, GAP);

        expect(chosen?.beat?.id).toBe('b1');
    });

    it('is finished when every part has aired, and quietly stops being offered', () => {
        const chosen = nextThread([arc('s1', [part('b1', 'One.', true), part('b2', 'Two.', true)]), anecdote('a1')], NOW, GAP);

        expect(chosen).toEqual({ id: 'a1' });
    });

    it('is skipped when it has no parts written yet', () => {
        // An arc somebody created and has not filled in. Not an error: there is simply nothing to
        // tell, and the shelf moves on.
        expect(nextThread([arc('s1', []), anecdote('a1')], NOW, GAP)).toEqual({ id: 'a1' });
    });
});

describe('a bit', () => {
    it('is always eligible, because a running joke never runs out', () => {
        expect(nextThread([{ id: 'b1', kind: 'bit', beats: [] }], NOW, GAP)).toEqual({ id: 'b1' });
    });

    it('waits out the gap like an arc does', () => {
        const chosen = nextThread([{ id: 'b1', kind: 'bit', beats: [], lastCarriedAt: NOW - 60_000 }, anecdote('a1')], NOW, GAP);

        expect(chosen).toEqual({ id: 'a1' });
    });
});

describe('a shelf with nothing to offer', () => {
    it('answers nothing rather than forcing a choice', () => {
        // An ordinary outcome, and the same one a character with no stories at all produces: the
        // break simply carries none.
        expect(nextThread([], NOW, GAP)).toBeUndefined();
        expect(nextThread([arc('s1', [part('b1', 'Told.', true)])], NOW, GAP)).toBeUndefined();
    });
});
