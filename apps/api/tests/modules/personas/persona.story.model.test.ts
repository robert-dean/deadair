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

import {
    readProposals,
    storyPrompt,
    MAX_DETAIL_CHARS,
    MAX_PROPOSALS,
    MAX_STORY_CHARS,
    recapPrompt,
    readRecaps,
} from '../../../src/modules/personas/persona.story.model.js';

const subject = { label: 'Overnight conspiracy host', style: 'an overnight host who believes the records are trying to tell you something' };

const existing = [{ title: 'The Barstow lights', story: 'You saw three lights over the desert.', details: ['The truck radio went to static.'] }];

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
            storyPrompt({ ...subject, diction: ['Short sentences'], avoid: ['wake up'] }, existing).find(message => message.role === 'user')
                ?.content ?? '';

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
        const found = readProposals(
            answer([{ kind: 'detail', title: 'the barstow LIGHTS', detail: 'The dogs would not go out that night.' }]),
            existing,
        );

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
        const found = readProposals(
            answer([{ kind: 'story', title: 'A tape', story: 'You never labelled it.', source: 'the station plays a lot of it' }]),
            existing,
        );

        expect(found[0]?.source).toBe('the station plays a lot of it');
    });

    it('takes no more than it asked for', () => {
        const many = Array.from({ length: MAX_PROPOSALS + 3 }, (_, index) => ({
            kind: 'story',
            title: `Story ${index}`,
            story: 'Something happened.',
        }));

        expect(readProposals(answer(many), existing)).toHaveLength(MAX_PROPOSALS);
    });
});

// The third proposal shape, for a story the character is already telling in parts. What keeps it
// honest is that it can only land on an ARC and can only be something that is not already there:
// a beat on an anecdote is a row nothing reads, and a beat restating a part it was shown is the
// model summarising rather than carrying the story on.
describe('proposing the next part of an arc', () => {
    const arc = {
        title: 'The letter',
        story: 'It started with a letter.',
        details: [],
        arc: true,
        beats: ['You opened it in the car park.'],
    };

    const answer = (proposals: unknown[]) => JSON.stringify({ proposals });

    it('reads a beat against the arc it names', () => {
        const read = readProposals(answer([{ kind: 'beat', title: 'The letter', beat: 'You read it twice.' }]), [arc]);

        expect(read).toEqual([{ kind: 'beat', title: 'The letter', beat: 'You read it twice.' }]);
    });

    it('drops one aimed at a story that is not told in parts', () => {
        const anecdote = { title: 'The Barstow lights', story: 'Three of them.', details: [] };

        expect(readProposals(answer([{ kind: 'beat', title: 'The Barstow lights', beat: 'And then nothing.' }]), [anecdote])).toEqual([]);
    });

    it('drops one aimed at a story that does not exist', () => {
        expect(readProposals(answer([{ kind: 'beat', title: 'Some other thing', beat: 'And then nothing.' }]), [arc])).toEqual([]);
    });

    it('drops one that repeats a part the arc already has', () => {
        expect(readProposals(answer([{ kind: 'beat', title: 'The letter', beat: '  you OPENED it in the car park. ' }]), [arc])).toEqual([]);
    });

    it('shows an arc as one, with its parts numbered so the next is the ask', () => {
        const [, user] = storyPrompt({ label: 'The overnight host', style: 'a voice for the small hours' }, [arc]);

        expect(user?.content).toContain('(told in parts)');
        expect(user?.content).toContain('1. You opened it in the car park.');
    });

    it('does not mark an ordinary story as told in parts', () => {
        const [, user] = storyPrompt({ label: 'The overnight host', style: 'a voice for the small hours' }, [
            { title: 'The Barstow lights', story: 'Three of them.', details: [] },
        ]);

        expect(user?.content).not.toContain('(told in parts)');
    });
});

// Recaps are the one thing this pass writes that nobody approves, so what is pinned is that they can
// only ever be about a bit that was actually asked about, and that the summariser is asked for a
// summary rather than for more material.
describe('summarising a running bit', () => {
    const bit = {
        id: 's1',
        title: 'The vending machine',
        story: 'The machine on the third floor has been broken since you started.',
        said: ['Still nobody has fixed it.', 'Week three.', 'I have started bringing my own crisps.'],
    };

    it('shows the whole run, so the arc of it is visible', () => {
        const [, user] = recapPrompt([bit]);

        // A pair of tellings says where a joke is now; a recap says what it has become, and that
        // needs the run.
        expect(user?.content).toContain('Still nobody has fixed it.');
        expect(user?.content).toContain('I have started bringing my own crisps.');
    });

    it('asks for a summary and forbids adding to it', () => {
        const [system] = recapPrompt([bit]);

        expect(system?.content).toMatch(/Summarise only what is there/);
        expect(system?.content).toMatch(/not what was said last/);
    });

    it('reads a recap back against the bit it names', () => {
        const read = readRecaps(JSON.stringify({ recaps: [{ title: 'The vending machine', recap: 'It has become a feud.' }] }), [bit]);

        // `tellings` is how much of the run it covered, so a later pass can tell whether the
        // character has actually moved it since.
        expect(read).toEqual([{ id: 's1', recap: 'It has become a feud.', tellings: 3 }]);
    });

    it('drops one for a bit nobody asked about', () => {
        expect(readRecaps(JSON.stringify({ recaps: [{ title: 'Some other thing', recap: 'It has become a feud.' }] }), [bit])).toEqual([]);
    });

    it('takes one recap per bit, not whichever came last', () => {
        const read = readRecaps(
            JSON.stringify({
                recaps: [
                    { title: 'The vending machine', recap: 'The first answer.' },
                    { title: 'The vending machine', recap: 'A second bite at it.' },
                ],
            }),
            [bit],
        );

        expect(read).toEqual([{ id: 's1', recap: 'The first answer.', tellings: 3 }]);
    });

    it('answers nothing for an answer it cannot read', () => {
        expect(readRecaps('the model said something else entirely', [bit])).toEqual([]);
    });
});

// The one proposal shape here that is NOTICED rather than invented, and therefore the one that can
// be checked. Its quote has to appear literally in something the station broadcast, which is what
// makes "you keep coming back to this" a claim about the corpus rather than a new idea.
describe('noticing a running thing the character already does', () => {
    const corpus = [
        'Anyway, the vending machine on the third floor is still broken.',
        'That was Iron Maiden. The vending machine remains broken, before you ask.',
    ];

    const answer = (proposals: unknown[]) => JSON.stringify({ proposals });

    it('keeps one whose quote is really in what was said', () => {
        const read = readProposals(
            answer([
                {
                    kind: 'bit',
                    title: 'The vending machine',
                    story: 'The machine on the third floor has been broken since you started.',
                    quote: 'the vending machine on the third floor is still broken',
                },
            ]),
            [],
            3,
            corpus,
        );

        expect(read).toHaveLength(1);
        expect(read[0]).toMatchObject({ kind: 'bit', title: 'The vending machine' });
    });

    it('drops one whose quote the station never said', () => {
        // A model noticing something that never happened is the one failure this shape exists to
        // make impossible.
        const read = readProposals(
            answer([{ kind: 'bit', title: 'The kettle', story: 'The kettle never works.', quote: 'the kettle has never once worked' }]),
            [],
            3,
            corpus,
        );

        expect(read).toEqual([]);
    });

    it('drops one carrying no quote at all', () => {
        const read = readProposals(answer([{ kind: 'bit', title: 'The kettle', story: 'The kettle never works.' }]), [], 3, corpus);

        expect(read).toEqual([]);
    });

    it('drops one when the pass was shown no corpus', () => {
        // Nothing to check against is not the same as nothing to check: a pass with no scripts must
        // not be able to propose a habit it cannot have seen.
        const read = readProposals(
            answer([
                { kind: 'bit', title: 'The vending machine', story: 'Broken.', quote: 'the vending machine on the third floor is still broken' },
            ]),
            [],
        );

        expect(read).toEqual([]);
    });

    it('shows the scripts to the model, or it has nothing to notice', () => {
        const [, user] = storyPrompt({ label: 'The host', style: 'a voice' }, [], 3, corpus);

        expect(user?.content).toContain('What they have actually said on air lately:');
        expect(user?.content).toContain('the vending machine on the third floor is still broken');
    });
});
