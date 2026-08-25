// What a turn is asked for, and the two things that are different about somebody who phoned in: they
// arrive in the middle of the programme and greet somebody, and they may say what they THINK.
//
// The rules underneath are the ones a station cannot afford to get wrong in the other direction, so
// the negative cases carry as much weight as the positive ones: a host must never be handed the
// caller's licence, and a caller with no rung must be held to the ordinary grounding rules.

import { describe, expect, it } from 'vitest';

import { beatPrompt } from '../../../src/modules/productions/production.prompt.js';
import type { CastMember } from '../../../src/modules/productions/production.cast.js';
import type { Persona } from '../../../src/modules/personas/persona.js';

const host: CastMember = { role: 'host', personaId: 'h1', personaKey: 'classic', name: 'Ray', voice: 'classic' };
const dale: CastMember = { role: 'caller', personaId: 'c1', personaKey: 'theorist', name: 'Dale', voice: 'theorist' };

const sheet = (over: Partial<Persona> = {}): Persona => ({
    id: 'c1',
    key: 'theorist',
    kind: 'caller',
    label: 'Caller with a theory',
    style: 'a listener who has worked something out',
    active: false,
    ...over,
});

const turn = (over: Parameters<typeof beatPrompt>[0]) => beatPrompt(over);
const systemOf = (messages: ReturnType<typeof beatPrompt>) => String(messages[0]?.content);
const userOf = (messages: ReturnType<typeof beatPrompt>) => String(messages[1]?.content);

const base = { kind: 'callin', title: 'Phone-in', ordinal: 2, words: 70 } as const;

describe('a turn written by a caller', () => {
    it('is told it is a listener on the phone rather than the person writing the programme', () => {
        const system = systemOf(turn({ ...base, speaker: dale, previousSpeaker: host }));

        expect(system).toContain('You are a listener who has phoned in');
        expect(system).not.toContain('You write one beat of');
    });

    it('greets somebody on its FIRST turn, which is the one place mid-programme that is right', () => {
        const system = systemOf(turn({ ...base, speaker: dale, previousSpeaker: host, firstTurn: true }));

        expect(system).toContain('You have just been put on air');
        // Measured on the first live call-in: the caller opened with "Hi, thanks for calling",
        // which is the presenter's line. Saying which way round the call went is the fix.
        expect(system).toContain('YOU rang THEM');
        // And is not simultaneously told not to greet anybody, which is the rule it replaces.
        expect(system).not.toContain('Do not greet anybody');
        expect(system).not.toContain('You have already introduced yourself');
    });

    it('does not say hello twice', () => {
        const system = systemOf(turn({ ...base, speaker: dale, previousSpeaker: host }));

        expect(system).toContain('You are already on the call');
        expect(system).toContain('Do not say hello again');
    });

    it('may say what it thinks, once its sheet has been given room', () => {
        const system = systemOf(turn({ ...base, speaker: dale, previousSpeaker: host, persona: sheet({ latitude: 'loose' }) }));

        expect(system).toContain('You may say what you THINK');
        // The licence REPLACES the ordinary rule rather than sitting beside it. Two rules that
        // disagree in one prompt produce neither.
        expect(system).not.toContain('Never invent a place, a date, a price');
    });

    it('keeps it theirs, and off anybody real', () => {
        const system = systemOf(turn({ ...base, speaker: dale, previousSpeaker: host, persona: sheet({ latitude: 'loose' }) }));

        expect(system).toContain('Never say a real, named person did something');
        expect(system).toContain('It stays yours');
    });

    it('is held to the ordinary rules when its sheet asked for no room', () => {
        // The rung is what asks for the licence. A caller who never asked for one is somebody on the
        // phone who talks like everybody else.
        const system = systemOf(turn({ ...base, speaker: dale, previousSpeaker: host, persona: sheet() }));

        expect(system).toContain('Never invent a place, a date, a price');
        expect(system).not.toContain('You may say what you THINK');
    });
});

describe('a turn written by the host', () => {
    it('never gets the licence, however loose the character it is answering', () => {
        const system = systemOf(turn({ ...base, speaker: host, previousSpeaker: dale, persona: sheet({ id: 'h1', latitude: 'unleashed' }) }));

        expect(system).not.toContain('You may say what you THINK');
        expect(system).toContain('Never invent a place, a date, a price');
    });

    it('is told not to confirm what the caller said, which is what makes the licence safe', () => {
        const system = systemOf(turn({ ...base, speaker: host, previousSpeaker: dale }));

        expect(system).toContain('Do not confirm one');
        expect(system).toContain('move the programme on');
    });

    it('is not told that when it is following its own turn', () => {
        const system = systemOf(turn({ ...base, speaker: host, previousSpeaker: host }));

        expect(system).not.toContain('Do not confirm one');
    });

    it('is given the caller by name, so somebody can actually be put on air', () => {
        const user = userOf(turn({ ...base, speaker: host, previousSpeaker: dale, runIn: 'and that is the thing about it' }));

        expect(user).toContain('Dale is on the line');
    });
});

describe('the run-in across a change of speaker', () => {
    it('is something to answer rather than a position to carry on from', () => {
        const user = userOf(turn({ ...base, speaker: dale, previousSpeaker: host, runIn: 'so what have you got for us' }));

        expect(user).toContain('Ray has just said this to you');
        expect(user).toContain('Answer them.');
    });

    it('stays a continuation between two turns of the same voice', () => {
        const user = userOf(turn({ ...base, speaker: host, previousSpeaker: host, runIn: 'and we will get to that' }));

        expect(user).toContain('The programme has just said this');
        expect(user).toContain('Start the next sentence after them');
    });
});

describe('a production with no cast', () => {
    it('is asked for exactly what it was asked for before any of this existed', () => {
        // The one case that must not have changed: a station that casts nobody gets the monologue
        // prompt, byte for byte.
        const system = systemOf(turn({ ...base }));

        expect(system).toContain('You write one beat of a callin for a radio station');
        expect(system).toContain('This beat is in the MIDDLE of the programme');
        expect(system).toContain('Make the beat about one thing and develop it');
        expect(system).not.toContain('Answer what was just said');
    });
});
