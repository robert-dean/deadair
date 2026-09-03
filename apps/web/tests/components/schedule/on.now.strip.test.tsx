// The strip's gap card used to say "Sustaining", which is also the name of a destination tab on
// this page. An eyebrow reading the same as a tab read as a link to it, when it is actually
// describing the gap the station is filling right now — so this pins the wording that replaced it.

import { describe, expect, it } from 'vitest';
import type { Persona, ScheduleNow, ScheduleSlot } from '@deadair/sdk';

import { OnNowStrip } from '../../../src/components/schedule/on.now.strip';
import { render, screen } from '../../utils/render';

const SLOTS: readonly ScheduleSlot[] = [];
const PERSONAS: readonly Persona[] = [];

describe('OnNowStrip', () => {
    it('names the gap "Between blocks" rather than "Sustaining", which is also a tab on this page', () => {
        // The first block starts in the future, so nothing covers `now` and the strip falls into
        // the gap arm rather than the live one.
        const current: ScheduleNow = {
            now: '2026-01-05 12:00:00',
            upcoming: [{ slotId: 'evening', label: 'Evening Drive', start: '2026-01-05 18:00:00', end: '2026-01-05 22:00:00' }],
        };

        render(<OnNowStrip current={current} slots={SLOTS} personas={PERSONAS} />);

        expect(screen.getByText('Between blocks')).toBeInTheDocument();
        expect(screen.queryByText('Sustaining')).not.toBeInTheDocument();
    });
});
