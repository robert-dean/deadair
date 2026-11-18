import { describe, expect, it } from 'vitest';

import { showSectionsOf } from '../../../src/components/schedule/show.sections';
import { linesOf, type ShowSummaryValues } from '../../../src/components/schedule/show.summary';
import { i18n } from '../../../src/i18n/i18n.setup';

const t = i18n.getFixedT(null, ['schedule', 'programme'] as const);

const breakfast: ShowSummaryValues = {
    label: 'Breakfast',
    startsAt: '06:00',
    endsAt: '10:00',
    days: ['1', '2', '3', '4', '5'],
    special: false,
    byRule: false,
    dates: [null, null],
    yearly: false,
    enabled: true,
    live: false,
    personaId: '',
    guestCount: 0,
    coHostCount: 0,
    sourceKind: undefined,
    mode: 'rotation',
    brief: '',
    eraFrom: '',
    eraTo: '',
    moods: [],
    mixFlow: false,
    callins: false,
};

describe('linesOf', () => {
    it('says when, who and from where, with the station standing in for anything not chosen', () => {
        expect(linesOf(t, breakfast, undefined)).toEqual([
            '06:00 until 10:00',
            'Mon, Tue, Wed, Thu, Fri',
            'The station’s own host',
            'Records the station chooses · Rotation',
        ]);
    });

    it('names the host, the brief, the period and the moods as the form has them', () => {
        const lines = linesOf(
            t,
            {
                ...breakfast,
                days: [],
                coHostCount: 2,
                sourceKind: 'chart',
                brief: 'warm',
                eraFrom: 1970,
                eraTo: 1989,
                moods: ['comfort', 'happiness'],
            },
            'Wayne',
        );

        expect(lines).toEqual([
            '06:00 until 10:00',
            'Every day',
            'Wayne',
            'With 2 co-hosts',
            'From a chart · Rotation',
            'Asked to play “warm”',
            'Records from 1970 to 1989',
            'Leans toward Comfort → Happiness',
        ]);
    });

    it('stops at the booking for a live show, which plays nothing of its own', () => {
        expect(linesOf(t, { ...breakfast, special: true, live: true, dates: ['2026-10-31', '2026-10-31'] }, 'Wayne')).toEqual([
            '06:00 until 10:00',
            '2026-10-31 to 2026-10-31',
            'Mon, Tue, Wed, Thu, Fri',
            'A live show: a presenter’s booking, with nothing of its own to play',
        ]);
    });

    it('says a show that is switched off never airs', () => {
        expect(linesOf(t, { ...breakfast, enabled: false }, undefined)).toContain('Not on the schedule, so it never airs');
    });
});

describe('showSectionsOf', () => {
    it('draws the repeat rules only for a rotation, and only the when-half for a live show', () => {
        expect(showSectionsOf({ live: false, mode: 'rotation' })).toEqual(['when', 'presents', 'music', 'says', 'sound', 'repeat']);
        expect(showSectionsOf({ live: false, mode: 'setlist' })).not.toContain('repeat');
        expect(showSectionsOf({ live: true, mode: 'rotation' })).toEqual(['when']);
    });
});
