// The operator's talk direction, as the prompt offers it and the guard holds it. What is pinned: it
// reaches only a shape that hears it, worded as a lean that is never to be stated as fact or read
// out; a script that copies six words of it in a row is refused in both readers and retried; and a
// script that names its subject is never refused, which is the case a short direction always is.

import { describe, expect, it } from 'vitest';

import { breakPrompt, TALK_BREAK_SHAPE, type BreakPromptShape } from '../../../src/modules/director/break.prompt.js';
import { DIRECTION_ECHO_WORDS, readAnswer, writeDecline } from '../../../src/modules/director/break.answer.guard.js';
import { retryNudge, worthRetrying } from '../../../src/modules/director/break.retry.js';
import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';

const previous = { title: 'Solid Air', artist: 'John Martyn' };
const next = { title: 'Pink Moon', artist: 'Nick Drake' };

const hearing: BreakPromptShape = { ...TALK_BREAK_SHAPE, hearsDirection: true };
const user = (request: BreakWriteRequest, shape: BreakPromptShape) =>
    breakPrompt(request, {}, shape).find(message => message.role === 'user')?.content ?? '';

describe('the talk direction in the prompt', () => {
    const request: BreakWriteRequest = { kind: 'talkbreak', previous, next, direction: "It's Sam's birthday tonight" };

    it('offers it to a shape that hears it, as a lean never to be stated as fact or read out', () => {
        const words = user(request, hearing);

        expect(words).toContain('"It\'s Sam\'s birthday tonight"');
        expect(words).toContain('You do not have to mention it.');
        expect(words).toContain('do not state it as a fact');
        expect(words).toContain('do not read it out or quote it');
    });

    it('says nothing of it to a shape that does not hear it', () => {
        expect(user(request, TALK_BREAK_SHAPE)).not.toContain('Sam');
    });

    it('says nothing when there is no direction', () => {
        expect(user({ kind: 'talkbreak', previous, next }, hearing)).not.toContain('A note from the station');
    });
});

describe('a direction read out', () => {
    const direction = "We're snowed in tonight, so keep it cosy and warm for everybody listening";
    const guard = { direction };

    it('refuses a script that copies six words of it in a row, in both readers', () => {
        const script = "That was Solid Air. We're snowed in tonight, so keep it cosy out there. Pink Moon next.";

        expect(readAnswer(script, guard)).toBeUndefined();
        expect(writeDecline(script, guard)?.fault).toBe('read-out-direction');
    });

    it('lets a script lean on it in its own words', () => {
        const script = 'Solid Air, John Martyn. Nobody is going anywhere in this snow, so stay warm. Pink Moon next.';

        expect(readAnswer(script, guard)).toBe(script);
        expect(writeDecline(script, guard)).toBeUndefined();
    });

    it('lets five words of it through, which is naming the subject rather than reading it', () => {
        expect(DIRECTION_ECHO_WORDS).toBe(6);
        const script = "That was Solid Air. We're snowed in tonight, so stay put. Pink Moon next.";

        expect(readAnswer(script, guard)).toBe(script);
    });

    it('never refuses a direction shorter than the run, even said whole', () => {
        const script = "That was Solid Air, and happy birthday Sam: it's Sam's birthday, after all. Pink Moon next.";

        expect(readAnswer(script, { direction: "Sam's birthday" })).toBe(script);
        expect(readAnswer(script, { direction: "It's Sam's birthday" })).toBe(script);
        expect(writeDecline(script, { direction: "Sam's birthday" })).toBeUndefined();
    });

    it('asks nothing of a guard with no direction', () => {
        const script = "We're snowed in tonight, so keep it cosy and warm for everybody listening. Solid Air.";

        expect(readAnswer(script)).toBe(script);
    });

    it('is worth a second ask, which tells the model to use its own words', () => {
        expect(worthRetrying('read-out-direction')).toBe(true);
        expect(retryNudge({ fault: 'read-out-direction', reason: '' })).toContain('in your own words');
    });
});
