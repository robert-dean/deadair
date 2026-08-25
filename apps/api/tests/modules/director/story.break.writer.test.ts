// The floor under a story break, which is the one floor in this station that is not a pool of
// phrasings. The material is already prose somebody wrote, so this writer reads it — and the whole
// point of the assertions here is the two branches around that: a story arrives and goes out as
// written, or there is none and the slot is passed over rather than filled with something invented.

import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';

import type { BreakWriteRequest } from '../../../src/modules/director/break.writer.js';
import { StoryBreakWriter, STORY_KIND, STORY_SHAPE, STORY_WRITER } from '../../../src/modules/director/story.break.writer.js';

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as Logger;

const story = {
    title: 'The Barstow lights',
    story: 'You saw three lights over the desert outside Barstow in ninety-seven.',
    details: [] as string[],
    timesTold: 0,
};

const request = (overrides: Partial<BreakWriteRequest> = {}): BreakWriteRequest => ({ kind: STORY_KIND, story, ...overrides });

describe('StoryBreakWriter', () => {
    it('is the floor for a story break', () => {
        const writer = new StoryBreakWriter(logger());

        expect(writer.kind).toBe(STORY_KIND);
        expect(writer.name).toBe(STORY_WRITER);
    });

    it('speaks the story as it was written', async () => {
        const writer = new StoryBreakWriter(logger());

        expect((await writer.write(request()))?.script).toBe(story.story);
    });

    // The half that makes a story worth a table rather than a sheet field: it grows, and a telling
    // that carries a detail nobody has heard is a telling nobody has heard.
    it('reads the details the story has picked up, after it', async () => {
        const writer = new StoryBreakWriter(logger());

        const written = await writer.write(request({ story: { ...story, details: ['The truck radio went to static.'] } }));

        expect(written?.script).toBe(`${story.story} The truck radio went to static.`);
    });

    it('names the break for the story rather than for its first words', async () => {
        // What a running order and a script history are read with. `title` is never spoken.
        const writer = new StoryBreakWriter(logger());

        expect((await writer.write(request()))?.label).toBe('The Barstow lights');
    });

    it('promises nothing about what plays next, because it says nothing about it', async () => {
        const writer = new StoryBreakWriter(logger());

        expect((await writer.write(request({ next: { title: 'Pink Moon', artist: 'Nick Drake' } })))?.claimsNext).toBe(false);
    });

    // The decline an operator has to be able to act on: a clock band asking a character with no
    // stories for one is a slot passed over every time it comes round.
    it('passes the slot over when there is no story, and says so once', async () => {
        const log = logger();
        const writer = new StoryBreakWriter(log);

        expect(await writer.write(request({ story: undefined }))).toBeUndefined();
        expect(log.info).toHaveBeenCalled();
    });
});

describe('STORY_SHAPE', () => {
    // Not optional material on a break about something else. The prompt drops the "you do not have
    // to" wording on this mode, because a presenter who declined would leave a break about nothing.
    it('tells the story rather than offering it', () => {
        expect(STORY_SHAPE.stories).toBe('told');
    });

    // A note about the record beside an anecdote about the presenter is an invitation to weld the
    // two together, which is the one failure this whole feature has to avoid.
    it('shows neither the record behind it nor any notes', () => {
        expect(STORY_SHAPE.showsPrevious).toBe(false);
        expect(STORY_SHAPE.showsFacts).toBe(false);
    });

    // Where it parts company with a bulletin: the accumulated half is the point here rather than a
    // hazard, since a story told by somebody who has been on this station for years is the ask.
    it('keeps the notebook', () => {
        expect(STORY_SHAPE.showsNotebook).not.toBe(false);
    });

    // `rotation.storyWords` is this kind's ceiling. A latitude raising it further would mean an
    // unleashed character's stories ran to a length the settings page never mentions.
    it('offers no latitude, because the room is the kind rather than the character', () => {
        expect(STORY_SHAPE.allowsLatitude).toBe(false);
    });
});
