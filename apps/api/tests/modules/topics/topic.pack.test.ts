// A station's subjects as a file. What is pinned: the file carries nothing about the station it came
// from, only the header can make it unusable, and an import never changes a subject this station holds.

import { describe, expect, it } from 'vitest';

import type { Topic } from '../../../src/modules/topics/topic.js';
import { packOfTopics, planTopicPack, TOPIC_PACK_FORMAT, TOPIC_PACK_VERSION } from '../../../src/modules/topics/topic.pack.js';
import type { TopicPack } from '../../../src/modules/topics/types/topics.types.js';

const sport: Topic = { id: 'a', kind: 'news', key: 'sport', label: 'Sport', config: { keywords: 'football' }, position: 3 };
const atlanta: Topic = { id: 'b', kind: 'weather', key: 'atlanta', label: 'Atlanta', config: {}, position: 0 };
const declared = new Set(['news', 'weather']);

const fileOf = (topics: TopicPack['topics']): TopicPack => ({ format: 'deadair.topics', version: 1, name: 'A file', topics });

describe('packOfTopics', () => {
    it('leaves out the id and the position', () => {
        expect(packOfTopics([sport])).toEqual({
            format: TOPIC_PACK_FORMAT,
            version: TOPIC_PACK_VERSION,
            name: 'Topics',
            topics: [{ kind: 'news', key: 'sport', label: 'Sport', config: { keywords: 'football' } }],
        });
    });
});

describe('planTopicPack', () => {
    it('adds what the station does not hold, after the last of its kind', () => {
        const reading = planTopicPack(fileOf([{ kind: 'news', key: 'tech', label: 'Technology', config: { a: 1 } }]), [sport], declared);
        expect(reading.adding).toEqual([{ kind: 'news', key: 'tech', label: 'Technology', config: { a: 1 }, position: 4 }]);
        expect(reading.skipped).toEqual([]);
    });

    it('numbers each kind on its own', () => {
        const reading = planTopicPack(
            fileOf([
                { kind: 'news', key: 'tech', label: 'Technology' },
                { kind: 'weather', key: 'macon', label: 'Macon' },
                { kind: 'news', key: 'arts', label: 'Arts' },
            ]),
            [sport, atlanta],
            declared,
        );
        expect(reading.adding.map(topic => [topic.key, topic.position])).toEqual([
            ['tech', 4],
            ['macon', 1],
            ['arts', 5],
        ]);
    });

    it('skips a kind and key it holds, even under another label', () => {
        const reading = planTopicPack(fileOf([{ kind: 'news', key: 'sport', label: 'Sports desk' }]), [sport], declared);
        expect(reading.adding).toEqual([]);
        expect(reading.skipped).toEqual(['Sports desk']);
    });

    it('treats the same key under another kind as another subject', () => {
        const reading = planTopicPack(fileOf([{ kind: 'weather', key: 'sport', label: 'Sport' }]), [sport], declared);
        expect(reading.adding).toHaveLength(1);
    });

    it('takes a key twice in one file once', () => {
        const reading = planTopicPack(
            fileOf([
                { kind: 'news', key: 'tech', label: 'Technology' },
                { kind: 'news', key: 'tech', label: 'Tech again' },
            ]),
            [],
            declared,
        );
        expect(reading.adding.map(topic => topic.label)).toEqual(['Technology']);
        expect(reading.skipped).toEqual(['Tech again']);
    });

    it('slugs a key the way a form does, so it matches what the station holds', () => {
        const reading = planTopicPack(fileOf([{ kind: 'news', key: 'Sport', label: 'Sport' }]), [sport], declared);
        expect(reading.skipped).toEqual(['Sport']);
    });

    it('reports a bad entry and keeps reading', () => {
        const reading = planTopicPack(
            fileOf([{ kind: 'news', label: 'No key at all' }, { nonsense: true }, { kind: 'news', key: 'tech', label: 'Technology' }]),
            [],
            declared,
        );
        expect(reading.adding.map(topic => topic.key)).toEqual(['tech']);
        expect(reading.dropped.map(dropped => dropped.entry)).toEqual([1, 2]);
        expect(reading.dropped[0]?.words).toBe('No key at all');
    });

    it('drops an entry whose label is only blanks', () => {
        const reading = planTopicPack(fileOf([{ kind: 'news', key: 'tech', label: '   ' }]), [], declared);
        expect(reading.adding).toEqual([]);
        expect(reading.dropped[0]?.reason).toBe('it needs a kind and a label');
    });

    it('adds a kind nobody declared and says so once', () => {
        const reading = planTopicPack(
            fileOf([
                { kind: 'traffic', key: 'a', label: 'A' },
                { kind: 'traffic', key: 'b', label: 'B' },
            ]),
            [],
            declared,
        );
        expect(reading.adding).toHaveLength(2);
        expect(reading.unknownKinds).toEqual(['traffic']);
    });
});
