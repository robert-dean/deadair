import { describe, expect, it } from 'vitest';
import { configFieldSchema } from '@deadair/plugin-sdk';

import { namesOwnShow, OWN_SHOW_BAND_KIND, OWN_SHOW_TOPIC_KIND } from '../../../src/modules/podcasts/own.show.topic.kind.js';

const topic = { id: 't1', key: 'evening-news', label: 'Evening News' };

describe('the own-show topic kind', () => {
    // Not plain "show", which the syndicated kind already is: the Subjects page heads each kind with its noun.
    it('is a subject for a podcast band, and calls one an own show', () => {
        expect(OWN_SHOW_TOPIC_KIND.kind).toBe(OWN_SHOW_BAND_KIND);
        expect(OWN_SHOW_BAND_KIND).toBe('podcast');
        expect(OWN_SHOW_TOPIC_KIND.noun).toEqual({ one: 'own show', many: 'own shows' });
    });

    // A show's id is a row id nobody could type, so the form offers the station's own shows.
    it("picks its show from the station's own shows, and requires one", () => {
        const [show] = OWN_SHOW_TOPIC_KIND.fields;

        expect(show).toMatchObject({ key: 'show', type: 'select', required: true, optionsFrom: 'station.ownShows' });
        expect(configFieldSchema.safeParse(show).success).toBe(true);
    });
});

describe('namesOwnShow', () => {
    it('is a podcast band with a topic', () => {
        expect(namesOwnShow({ at: 'clock', minute: 0, hour: 18, kind: 'podcast', topic })).toBe(true);
        expect(namesOwnShow({ at: 'clock', minute: 0, hour: 18, kind: ' Podcast ', topic })).toBe(true);
    });

    // A podcast band with no topic stays the production scheduler's: a programme about the broadcast it airs inside.
    it('is not a podcast band with no topic, nor another kind with one', () => {
        expect(namesOwnShow({ at: 'clock', minute: 0, kind: 'podcast' })).toBe(false);
        expect(namesOwnShow({ at: 'clock', minute: 30, kind: 'news', topic })).toBe(false);
    });
});
