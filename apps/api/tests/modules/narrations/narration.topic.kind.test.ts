import { describe, expect, it } from 'vitest';

import { NARRATION_TOPIC_KIND } from '../../../src/modules/narrations/narration.topic.kind.js';
import { isNarrationKind, NARRATION_KIND } from '../../../src/modules/narrations/narration.kind.js';

describe('the narration topic kind', () => {
    it('names one series, from the list only the station can assemble', () => {
        // A series id is the plugin's qualified id for it, which nobody could type.
        expect(NARRATION_TOPIC_KIND.kind).toBe(NARRATION_KIND);
        expect(NARRATION_TOPIC_KIND.fields).toHaveLength(1);
        expect(NARRATION_TOPIC_KIND.fields[0]).toMatchObject({ key: 'series', type: 'select', required: true, optionsFrom: 'station.narrationSeries' });
    });

    it('requires the series rather than carrying anything', () => {
        // Unlike a syndicated band, which with no topic carries the newest episode of any show. There
        // is no such answer here: "the next piece of any series" would read chapter four of one book
        // and then chapter one of another.
        expect(NARRATION_TOPIC_KIND.fields[0]?.required).toBe(true);
    });
});

describe('isNarrationKind', () => {
    it('reads a band kind however it was typed', () => {
        for (const kind of ['narration', 'Narration', '  NARRATION  ']) expect(isNarrationKind(kind), kind).toBe(true);
    });

    it('is not the syndicated kind, nor a production kind', () => {
        for (const kind of ['syndicated', 'podcast', 'callin', 'news', '']) expect(isNarrationKind(kind), kind).toBe(false);
    });
});
