import { describe, expect, it } from 'vitest';
import { configFieldSchema } from '@deadair/plugin-sdk';

import { SYNDICATED_TOPIC_KIND } from '../../../src/modules/podcasts/syndicated.topic.kind.js';
import { isSyndicatedKind, SYNDICATED_KIND } from '../../../src/modules/podcasts/syndicated.kind.js';

describe('the syndicated topic kind', () => {
    it('calls one of these a show', () => {
        expect(SYNDICATED_TOPIC_KIND.kind).toBe(SYNDICATED_KIND);
        expect(SYNDICATED_TOPIC_KIND.noun).toEqual({ one: 'show', many: 'shows' });
    });

    // A show's id is qualified with the plugin that carries it, which nobody could type, so the form
    // offers the shows the station carries — through a vocabulary the SDK's own schema accepts.
    it('picks its show from the shows the station carries, and requires one', () => {
        const [show] = SYNDICATED_TOPIC_KIND.fields;

        expect(show).toMatchObject({ key: 'show', type: 'select', required: true, optionsFrom: 'station.podcastShows' });
        expect(configFieldSchema.safeParse(show).success).toBe(true);
    });
});

describe('isSyndicatedKind', () => {
    it.each(['syndicated', ' Syndicated ', 'SYNDICATED'])('reads %j as a programme band', kind => {
        expect(isSyndicatedKind(kind)).toBe(true);
    });

    // `podcast` is a kind the station PRODUCES, and must stay the production scheduler's.
    it.each(['podcast', 'news', ''])('does not read %j as one', kind => {
        expect(isSyndicatedKind(kind)).toBe(false);
    });
});
