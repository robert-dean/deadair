// The operator's talk direction on a programme. What is pinned: a banter's presenters are told it in
// the break prompt's own words, a caller or a guest never is whatever the request carries, and a beat
// that copies six words of it in a row is corrected while one that names its subject is not.

import { describe, expect, it } from 'vitest';

import { beatPrompt, type BeatRequest } from '../../../src/modules/productions/production.prompt.js';
import { checkBeat, directionFaults } from '../../../src/modules/productions/production.checks.js';
import { directionNote } from '../../../src/modules/director/talk.direction.words.js';

const wayne = { role: 'host', name: 'Wayne' } as const;
const garth = { role: 'cohost', name: 'Garth' } as const;
const dana = { role: 'caller', name: 'Dana' } as const;
const direction = "We're snowed in tonight, so keep it cosy and warm for everybody";

const user = (request: BeatRequest) => beatPrompt(request).find(message => message.role === 'user')?.content ?? '';

describe('a banter and the talk direction', () => {
    it("tells a presenter on a banter, in the break prompt's own words", () => {
        const words = user({ kind: 'banter', ordinal: 1, words: 40, speaker: garth, previousSpeaker: wayne, coHosts: [garth], direction });

        expect(words).toContain(directionNote(direction));
    });

    it('never tells a caller or anybody on a programme with no co-host', () => {
        expect(user({ kind: 'callin', ordinal: 1, words: 40, speaker: dana, previousSpeaker: wayne, direction })).not.toContain('snowed in');
        expect(user({ kind: 'callin', ordinal: 0, words: 40, speaker: wayne, guest: dana, direction })).not.toContain('snowed in');
    });
});

describe('directionFaults', () => {
    it('corrects a beat that reads six words of it out', () => {
        expect(directionFaults({ text: "We're snowed in tonight, so keep it cosy, Garth.", direction })).toHaveLength(1);
    });

    it('leaves a beat that leans on it in its own words', () => {
        expect(directionFaults({ text: 'Nobody is getting out of this street till Tuesday.', direction })).toEqual([]);
    });

    it('never refuses a beat for naming the subject of a short direction', () => {
        expect(directionFaults({ text: "It's Sam's birthday, so behave.", direction: "Sam's birthday" })).toEqual([]);
    });

    it('asks nothing of a beat that heard none, and is part of the check pass', () => {
        expect(directionFaults({ text: direction })).toEqual([]);
        expect(checkBeat({ text: `${direction}. Anyway, Garth.`, words: 12, ordinal: 1, direction }).join(' ')).toContain('reads out the note');
    });
});
