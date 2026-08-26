// What a turn is asked for, and the two things that are different about somebody who phoned in: they
// arrive in the middle of the programme and greet somebody, and they may say what they THINK.
//
// The rules underneath are the ones a station cannot afford to get wrong in the other direction, so
// the negative cases carry as much weight as the positive ones: a host must never be handed the
// caller's licence, and a caller with no rung must be held to the ordinary grounding rules.

import { describe, expect, it } from 'vitest';

import { beatPrompt, outlinePrompt } from '../../../src/modules/productions/production.prompt.js';
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

describe('what a speaker may perform', () => {
    it('offers a caller the wider set, because a phone call is where a throat-clear belongs', () => {
        const system = systemOf(turn({ ...base, speaker: dale, previousSpeaker: host, reactions: ['cough', 'sniff'] }));

        expect(system).toContain('[cough], [sniff]');
        expect(system).toContain('You are on a telephone, not in a studio');
    });

    it('says nothing at all when the engine performs nothing', () => {
        // The same bargain the break prompt keeps: a model is told about the facility it has, and a
        // station whose engine only reads words gets a prompt with no notation in it.
        const system = systemOf(turn({ ...base, speaker: dale, previousSpeaker: host }));

        expect(system).not.toContain('square brackets');
    });
});

// The soundboard, which a production carries on the same terms a break does with one exception it
// does not: a caller is never offered one. That is a fact about the fiction rather than a limit —
// the board is the station's, in the studio, and somebody on a telephone is somewhere else.
describe('the soundboard in a beat', () => {
    it('offers a host the board, named exactly as a script has to write it', () => {
        const system = systemOf(turn({ ...base, speaker: host, pads: ['airhorn', 'rimshot'] }));

        expect(system).toContain('[sfx:airhorn], [sfx:rimshot]');
        // The failure this closes is a model NARRATING the drop, which reads as somebody describing
        // their own soundboard out loud.
        expect(system).toContain('do not describe it or say its name as words');
    });

    it('says it is in front of them, because a beat is one voice in a room', () => {
        const system = systemOf(turn({ ...base, speaker: host, pads: ['airhorn'] }));

        expect(system).toContain('There is a soundboard in front of you');
    });

    it('says nothing about a soundboard when there is none to reach for', () => {
        const system = systemOf(turn({ ...base, speaker: host }));

        expect(system).not.toContain('soundboard');
    });

    // The job is what refuses a caller, so this is the belt to that braces: a prompt handed pads for
    // somebody on the phone would still print them, and the reason it never is lives one file over.
    // What this pins is that the two rules are separate — the reaction rule still adapts to a caller
    // while the pad rule has no caller wording at all, because it is never shown to one.
    it('keeps the pad rule and the reaction rule as two different instructions', () => {
        const system = systemOf(turn({ ...base, speaker: dale, previousSpeaker: host, reactions: ['cough'] }));

        expect(system).toContain('You are on a telephone, not in a studio');
        expect(system).not.toContain('soundboard');
    });
});

// A caller who has rung before. Everything here comes out of `persona_notes` and `persona_stories`,
// which are keyed by a persona key and know nothing about breaks — so the only new thing a
// production needed was to write its own history down.
// A production had no clock of any kind: the outline never knew when it went out and neither did a
// beat, so a call-in written at five to one in the afternoon said "tonight" six times in seven turns
// and every check it passed was about something else.
describe('the half of the day a production goes out in', () => {
    it('tells every beat, because a beat is its own model call and knows nothing else', () => {
        const system = systemOf(turn({ ...base, dayPart: 'this afternoon' }));

        expect(system).toMatch(/It is this afternoon where your listener is/);
        // The negative half, which is the half it is actually guarding: a model told only what time
        // it is still reaches for the light and the weather to open on.
        expect(system).toMatch(/do not call it any other part of the day/i);
    });

    it('says nothing at all when the station could not work out when it airs', () => {
        expect(systemOf(turn(base))).not.toMatch(/where your listener is/);
    });

    it('tells the OUTLINE too, because a throughline is an instruction every beat then obeys', () => {
        // A plan about winding down at the end of a long day cannot be undone by a rule in the beat
        // prompt saying it is the morning: the beat has been given a brief and it will write to it.
        const messages = outlinePrompt({ kind: 'callin', title: 'Phone-in', beats: 7, wordsPerBeat: 70, dayPart: 'this morning' });

        expect(String(messages[1]?.content)).toMatch(/goes out this morning/);
    });
});

describe('what a character remembers', () => {
    it('puts what it has settled into beside the sheet, where who it IS belongs', () => {
        const system = systemOf(
            turn({ ...base, speaker: dale, previousSpeaker: host, persona: sheet(), notebook: { trait: ['You never quite finish a sentence.'], said: [] } }),
        );

        expect(system).toContain('Things you have settled into on this station');
        expect(system).toContain('never quite finish a sentence');
    });

    it('puts what it has SAID beside the moment, where what it DID belongs', () => {
        const messages = turn({ ...base, speaker: dale, previousSpeaker: host, notebook: { trait: [], said: ['Rang in about the lights again.'] } });

        expect(userOf(messages)).toContain('Rang in about the lights again.');
        expect(systemOf(messages)).not.toContain('Rang in about the lights again.');
    });

    it('offers the sayings rather than asking for them', () => {
        // Measured on the break path and inherited whole: "work at most one of them in" reads as an
        // instruction to work one in.
        const user = userOf(turn({ ...base, speaker: dale, previousSpeaker: host, notebook: { trait: [], said: ['Rang in about the lights.'] } }));

        expect(user).toContain('You do not have to mention any of them');
    });

    it('offers a story with the fence that keeps it off the records', () => {
        const user = userOf(
            turn({
                ...base,
                speaker: dale,
                previousSpeaker: host,
                story: { title: 'The lights', story: 'Three lights over the desert, moving together.', details: [], timesTold: 0 },
            }),
        );

        expect(user).toContain('Three lights over the desert');
        expect(user).toContain('it happened to YOU');
        expect(user).toContain('not a fact about any record');
    });

    it('says a story has been told before, only once it has', () => {
        const told = (timesTold: number) =>
            userOf(turn({ ...base, speaker: dale, previousSpeaker: host, story: { title: 'The lights', story: 'Three lights.', details: [], timesTold } }));

        expect(told(2)).toContain('somebody tells a story twice');
        expect(told(0)).not.toContain('somebody tells a story twice');
    });

    it('carries nothing at all for a character with nothing, which is the byte-identical case', () => {
        const withNothing = turn({ ...base, speaker: dale, previousSpeaker: host, notebook: { trait: [], said: [] } });
        const withNone = turn({ ...base, speaker: dale, previousSpeaker: host });

        expect(withNothing).toEqual(withNone);
    });
});
