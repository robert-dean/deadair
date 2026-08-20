// Which category a story belongs to is decided by three signals of very different quality, and the
// failures are asymmetric: a category that matches too little makes a bulletin decline, which is
// visible and says so, while one that matches too much puts a chip shop in the technology bulletin
// and nothing anywhere reports it. So the cases below lean on what must NOT match.

import { describe, expect, it } from 'vitest';

import { categoriesOf, newsTopicRules, rankOf, type ClassifiableStory } from '../../../src/modules/news/news.classify.js';
import type { Topic } from '../../../src/modules/topics/topic.js';

const topic = (key: string, config: Record<string, unknown>, label?: string): Topic => ({
    id: `topic-${key}`,
    kind: 'news',
    key,
    label: label ?? key,
    config,
    position: 0,
});

const tech = newsTopicRules(topic('technology', { labels: ['Technology', 'Tech'], words: ['semiconductor', 'app store'] }));

const story = (over: Partial<ClassifiableStory> = {}): ClassifiableStory => ({
    title: 'A perfectly ordinary morning',
    ...over,
});

describe('rankOf', () => {
    it('takes the category the FEED declares as definite, whatever the story says', () => {
        expect(rankOf(story({ feedCategory: 'technology', title: 'Council votes on the bypass' }), tech)).toBe('feed');
    });

    it('answers to the category by its label as well as by its key', () => {
        // A category is written once and named twice: picked off a list it is the key, typed into a
        // plugin that could not offer the list it is whatever the operator would call it.
        const us = newsTopicRules(topic('us', {}, 'US news'));

        expect(rankOf(story({ feedCategory: 'us' }), us)).toBe('feed');
        expect(rankOf(story({ feedCategory: 'U.S. News' }), us)).toBe('feed');
        expect(rankOf(story({ feedCategory: 'world' }), us)).toBeUndefined();
    });

    it('leaves a feed that named no category to be judged on what its stories say', () => {
        expect(rankOf(story({ title: 'Shortage of semiconductor parts' }), tech)).toBe('word');
        expect(rankOf(story({ feedCategory: '  ', title: 'A quiet day' }), tech)).toBeUndefined();
    });

    it("reads the publisher's own label next", () => {
        expect(rankOf(story({ categories: ['Business', 'Technology'] }), tech)).toBe('label');
    });

    it('falls to a word in the headline or the teaser, and says that is what it did', () => {
        expect(rankOf(story({ title: 'Shortage of semiconductor parts drags on' }), tech)).toBe('word');
        expect(rankOf(story({ summary: 'The app store rules change on Friday.' }), tech)).toBe('word');
    });

    it('answers nothing for a story that carries none of the three', () => {
        expect(rankOf(story(), tech)).toBeUndefined();
    });

    it('takes the STRONGEST signal rather than adding them up', () => {
        // Two words and a label present: still a label, because a long word list must not be able
        // to outrank a publisher who has already sorted their own newsroom.
        const both = story({ categories: ['Tech'], title: 'Semiconductor and app store news' });

        expect(rankOf(both, tech)).toBe('label');
        // And the feed outranks the label for the same reason one step up.
        expect(rankOf({ ...both, feedCategory: 'technology' }, tech)).toBe('feed');
    });

    // The failure this exists for is silent: a technology category naming `ai` matches "said",
    // "chain" and "certain" on a substring test, which is most of a front page.
    it('matches a word as a whole word and never inside another', () => {
        const rules = newsTopicRules(topic('technology', { words: ['ai'] }));

        expect(rankOf(story({ title: 'AI writes the news' }), rules)).toBe('word');
        expect(rankOf(story({ title: 'She said the chain would hold' }), rules)).toBeUndefined();
    });

    it('matches a label whole, so Tech does not catch Biotech', () => {
        expect(rankOf(story({ categories: ['Biotech'] }), tech)).toBeUndefined();
    });

    it('reads a label through punctuation and accents', () => {
        const rules = newsTopicRules(topic('us', { labels: ['U.S. news'] }));

        expect(rankOf(story({ categories: ['US News'] }), rules)).toBe('label');
    });

    it('lets a category be written as lines, as a comma list, or as a real array', () => {
        const lines = newsTopicRules(topic('technology', { words: 'semiconductor\napp store' }));
        const commas = newsTopicRules(topic('technology', { words: 'semiconductor, app store' }));

        expect(rankOf(story({ title: 'The app store rules change' }), lines)).toBe('word');
        expect(rankOf(story({ title: 'The app store rules change' }), commas)).toBe('word');
    });

    it('matches nothing for a category nobody has filled in, rather than everything', () => {
        // `local` ships exactly like this, because only the operator knows their town. The bulletin
        // declining is the honest answer; a category that matched everything would not be. It still
        // answers to its own name, which is the one thing a category has without being finished.
        const empty = newsTopicRules(topic('local', {}));

        expect(rankOf(story({ categories: ['Anything'], title: 'Anything at all' }), empty)).toBeUndefined();
        expect(rankOf(story({ feedCategory: 'local' }), empty)).toBe('feed');
    });

    it('reads a config somebody has broken as an empty category rather than throwing', () => {
        const nonsense = newsTopicRules(topic('technology', { words: 42, labels: { a: 1 } }));

        expect(rankOf(story({ title: 'Anything' }), nonsense)).toBeUndefined();
    });
});

describe('categoriesOf', () => {
    const science = newsTopicRules(topic('science', { labels: ['Science'], words: ['spacecraft'] }));

    it('answers every category a story belongs to, strongest first', () => {
        const launch = story({ categories: ['Science'], title: 'Semiconductor firm builds a spacecraft' });

        // Science by its publisher's label, technology by a word: one story, two bulletins, and the
        // stronger claim first because that is the order a bulletin should read them in.
        expect(categoriesOf(launch, [tech, science])).toEqual([
            { key: 'science', rank: 'label' },
            { key: 'technology', rank: 'word' },
        ]);
    });

    it('answers nothing for a story no category claims', () => {
        expect(categoriesOf(story(), [tech, science])).toEqual([]);
    });
});
