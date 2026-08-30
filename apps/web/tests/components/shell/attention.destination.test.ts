// The station names a page and the console decides which of its own pages that is. The table is
// worth pinning because everything it answers is a link that has to work: a route this console does
// not have must lose its button rather than draw a broken one, and a state the station asks for
// must reach the Tracks list as a validated word rather than as whatever text arrived.

import { describe, expect, it } from 'vitest';

import { attentionCounts, attentionDestinationOf, attentionNavPageOf } from '../../../src/components/shell/attention.destination';
import { CATALOG_TRACK_DEFAULTS } from '../../../src/components/catalog/catalog.page.params';

describe('attentionDestinationOf', () => {
    it('lands a filtered row on the Tracks list already narrowed to that state', () => {
        expect(attentionDestinationOf('/catalog?state=benched')).toEqual({
            link: { to: '/catalog/tracks', search: { ...CATALOG_TRACK_DEFAULTS, state: 'benched' } },
            label: 'Library',
        });
    });

    it('drops a state this console has no filter for rather than putting it in the URL', () => {
        // The station is free to grow a state before the console has a chip for it, and a
        // hand-typed one should land on the list rather than on a validation error.
        expect(attentionDestinationOf('/catalog?state=nonsense')?.link.search).toEqual(CATALOG_TRACK_DEFAULTS);
    });

    it('still answers the unfiltered catalog with the Tracks list', () => {
        expect(attentionDestinationOf('/catalog')).toEqual({
            link: { to: '/catalog/tracks', search: CATALOG_TRACK_DEFAULTS },
            label: 'Library',
        });
    });

    it('draws nothing for a route this console does not have', () => {
        expect(attentionDestinationOf('/lineups')).toBeUndefined();
    });

    it('counts a filtered catalog row against the same nav entry as an unfiltered one', () => {
        // The badge and the row read one table, which is what stops a fault being badged on one
        // page while its row links to another.
        expect(attentionNavPageOf('/catalog?state=failing')).toBe(attentionNavPageOf('/catalog'));

        const counts = attentionCounts([
            { code: 'benchedCopies', severity: 'warning', title: 'a', detail: 'a', route: '/catalog?state=benched' },
            { code: 'failingFetches', severity: 'warning', title: 'b', detail: 'b', route: '/catalog?state=failing' },
        ]);

        expect(counts.get('/catalog/tracks')).toEqual({ count: 2, severity: 'warning' });
    });
});
