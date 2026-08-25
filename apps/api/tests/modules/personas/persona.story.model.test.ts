// What the station asks a model to remember on a character's behalf, and what it will accept back.
//
// This is the one pass on the station that INVENTS, so there is no quote to check an answer against
// and nothing here can ask whether a story is true. Every assertion below is therefore about the
// checks that CAN be made without truth: both halves present, inside the column's bounds, not
// something this character already has, and — for a detail — naming a story that actually exists.
//
// The safeguard that replaces the missing check is a state rather than a parse, and it lives in
// `persona.story.pass.service.ts`: everything this produces is written `suggested`.

import { describe, expect, it } from 'vitest';

import { readProposals, storyPrompt, MAX_DETAIL_CHARS, MAX_PROPOSALS, MAX_STORY_CHARS } from '../../../src/modules/personas/persona.story.model.js';

const subject = { label: 'Overnight conspiracy host', style: 'an overnight host who believes the records are trying to tell you something' };

const existing = [
    { title: 'The Barstow lights', story: 'You saw three lights over the desert.', details: ['The truck radio went to static.'] },
];

const answer = (proposals: unknown) => JSON.stringify({ proposals });

describe('storyPrompt', () => {
    it('shows the character what it already has, by the handle a detail has to name', () => {
        const user = storyPrompt(subject, existing).find(message => message.role === 'user')?.content ?? '';

        expect(user).toContain('"The Barstow lights"');
        expect(user).toContain('The truck radio went to static.');
    });

    it('says plainly that a character with nothing is an ordinary state', () => {
        const user = storyPrompt(subject, []).find(message => message.role === 'user')?.content ?? '';

        expect(user).toMatch(/no stories yet/i);
    });

    // The one rule here that is a correctness rule rather than a taste one. A record can be in a
    // story; a gig, a date or a meeting is the station inventing a fact about somebody real.
    it('permits the music and forbids a claim about it', () => {
        const system = storyPrompt(subject, existing).find(message => message.role === 'system')?.content ?? '';

        expect(system).toMatch(/never a gig, a date, a venue, a meeting/i);
        expect(system).toMatch(/may be a claim about a real person/i);
    });

    // The station reads a story out as it stands when no model is available, so a note towards one
    // is a break that trails off.
    it('asks for a script rather than a summary', () => {
        const system = storyPrompt(subject, existing).find(message => message.role === 'system')?.content ?? '';

        expect(system).toMatch(/as a SCRIPT/);
        expect(system).toMatch(/empty list. That is a normal answer/i);
    });

    it('carries the sheet, so a proposal comes back in the character’s own voice', () => {
        const user =
            storyPrompt({ ...subject, diction: ['Short sentences'], avoid: ['wake up'] }, existing).find(message => message.role === 'user')?.content ?? '';

        expect(user).toContain('Short sentences');
        expect(user).toContain('wake up');
    });
});

describe('readProposals', () => {
    it('reads a new story', () => {
        const found = readProposals(answer([{ kind: 'story', title: 'The pressing that plays itself', story: 'It never runs out.' }]), existing);

        expect(found).toEqual([{ kind: 'story', title: 'The pressing that plays itself', story: 'It never runs out.' }]);
    });

    it('reads a detail against the story it names, under that story’s own spelling of the handle', () => {
        const found = readProposals(answer([{ kind: 'detail', title: 'the barstow LIGHTS', detail: 'The dogs would not go out that night.' }]), existing);

        expect(found).toEqual([{ kind: 'detail', title: 'The Barstow lights', detail: 'The dogs would not go out that night.' }]);
    });

    // Dropped rather than promoted to a new story: a sentence written as a fragment would be
    // attached to a story it was never about, which is the same call `kindOf` makes one file over.
    it('drops a detail on a story this character does not have', () => {
        expect(readProposals(answer([{ kind: 'detail', title: 'A night in Reno', detail: 'It rained.' }]), existing)).toEqual([]);
    });

    it('drops a story under a handle this character already uses', () => {
        expect(readProposals(answer([{ kind: 'story', title: 'The Barstow lights', story: 'A different night entirely.' }]), existing)).toEqual([]);
    });

    it('drops anything word for word the same as something already held', () => {
        const found = readProposals(
            answer([
                { kind: 'story', title: 'Another name for it', story: 'You saw three lights over the desert.' },
                { kind: 'detail', title: 'The Barstow lights', detail: 'The truck radio went to static.' },
            ]),
            existing,
        );

        expect(found).toEqual([]);
    });

    it('drops half an answer rather than repairing it', () => {
        const found = readProposals(
            answer([
                { kind: 'story', title: 'No telling' },
                { kind: 'story', story: 'No handle' },
                { kind: 'invention', title: 'Wrong kind', story: 'A story.' },
            ]),
            existing,
        );

        expect(found).toEqual([]);
    });

    it('drops anything past the column’s own bounds', () => {
        const found = readProposals(
            answer([
                { kind: 'story', title: 'Too long', story: 'x'.repeat(MAX_STORY_CHARS + 1) },
                { kind: 'detail', title: 'The Barstow lights', detail: 'y'.repeat(MAX_DETAIL_CHARS + 1) },
            ]),
            existing,
        );

        expect(found).toEqual([]);
    });

    // Tolerant of the wrapping, strict about the content: a local model fences its JSON or writes
    // its reasoning first, and none of that is a reason to lose the answer.
    it('finds the object inside whatever the model wrapped it in', () => {
        const wrapped = `Here you go:\n\`\`\`json\n${answer([{ kind: 'story', title: 'A tape', story: 'You never labelled it.' }])}\n\`\`\``;

        expect(readProposals(wrapped, existing)).toHaveLength(1);
    });

    it('answers nothing for an unparseable answer, an empty list, or no list at all', () => {
        expect(readProposals('I would rather not.', existing)).toEqual([]);
        expect(readProposals(answer([]), existing)).toEqual([]);
        expect(readProposals('{"stories":[]}', existing)).toEqual([]);
    });

    it('keeps the source, which is what the operator reads a proposal against', () => {
        const found = readProposals(answer([{ kind: 'story', title: 'A tape', story: 'You never labelled it.', source: 'the station plays a lot of it' }]), existing);

        expect(found[0]?.source).toBe('the station plays a lot of it');
    });

    it('takes no more than it asked for', () => {
        const many = Array.from({ length: MAX_PROPOSALS + 3 }, (_, index) => ({ kind: 'story', title: `Story ${index}`, story: 'Something happened.' }));

        expect(readProposals(answer(many), existing)).toHaveLength(MAX_PROPOSALS);
    });
});
