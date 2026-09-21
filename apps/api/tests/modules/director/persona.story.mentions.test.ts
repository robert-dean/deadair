// Whether a break told the story it was offered decides whether a listener ever gets the next part
// of it, so the bar is the thing under test here rather than the plumbing.
//
// It leans NO on purpose, and the asymmetry is worth restating: a false no tells the story again in
// different words, bounded by the cadence gap, and a listener hears the character return to
// something. A false yes marks a part as told that nobody heard, the next break moves past it, and
// nothing anywhere notices. So one shared word is not enough and two is.

import { describe, expect, it } from 'vitest';

import { mentionsStory } from '../../../src/modules/director/persona.story.mentions.js';

const barstow = {
    text: 'You saw three lights hanging over the desert outside Barstow, and the truck radio went to static.',
    details: ['The dogs would not go out that night.'],
};

describe('a break that reached for the story', () => {
    it('is stamped when it uses the story’s own words', () => {
        expect(mentionsStory('Those lights over the desert still bother me, you know.', barstow)).toBe(true);
    });

    it('counts a detail as the story, because a break may reach for one instead', () => {
        expect(mentionsStory('Funny thing, the dogs would not go out that night either.', barstow)).toBe(true);
    });

    it('does not care about case or curly apostrophes', () => {
        expect(mentionsStory('BARSTOW. The DESERT. I have told you this one.', barstow)).toBe(true);
    });
});

describe('a break that left it alone', () => {
    it('is not stamped for saying nothing about it', () => {
        // The ordinary outcome of an offer, and the prompt says most breaks are better without one.
        expect(mentionsStory('That was Iron Maiden, and this is the Scorpions.', barstow)).toBe(false);
    });

    it('is not stamped on one shared word alone', () => {
        // "static" is a real word about a real thing and a break may reach it by another road. One
        // coincidence is not the break reaching for the material; two is.
        expect(mentionsStory('There was a bit of static on that last one.', barstow)).toBe(false);
    });

    it('is not stamped on grammar the two texts were always going to share', () => {
        expect(mentionsStory('There is something about this one, and I could never say what.', barstow)).toBe(false);
    });

    it('is not stamped on short words', () => {
        expect(mentionsStory('You saw the one that went out over the night.', barstow)).toBe(false);
    });
});

describe('what must not be read as the story', () => {
    it('ignores a record the break was told to name', () => {
        // A story about a desert offered in front of a record called Desert is otherwise one anchor
        // up before the break has said anything at all.
        const guard = { names: [{ artist: 'Kyuss', title: 'Desert' } as never, { artist: 'Them', title: 'Barstow' } as never] };

        expect(mentionsStory('Here is Desert by Kyuss, and then Barstow.', barstow, guard)).toBe(false);
    });

    it('ignores the character’s own diction markers', () => {
        // Markers are asked for by name in every prompt and counted in every answer, so a marker
        // that also appears in a story is a word the break was always going to say. Counting them
        // would mark every break as having told the story — `overusedWords`' hazard one file over.
        const shown = { text: 'You were shipmate to a man who swore the desert lights followed him.', diction: ['shipmate', 'swore'] };

        expect(mentionsStory('Listen, shipmate, I swore I would play this one.', shown)).toBe(false);
    });
});

describe('the bar itself', () => {
    it('takes one anchor when the story has only one to offer', () => {
        // A story somebody wrote in six words has nothing else to match on, and refusing to ever
        // stamp it would leave exactly those stories never progressing.
        expect(mentionsStory('I still think about Barstow.', { text: 'Barstow.' })).toBe(true);
    });

    it('says no for a story with nothing distinctive in it at all', () => {
        expect(mentionsStory('There was a thing that was there.', { text: 'It was there.' })).toBe(false);
    });

    it('says no for an empty script', () => {
        expect(mentionsStory('', barstow)).toBe(false);
    });
});
