// A block ending at midnight was on the On now strip and missing from both timetable views, because
// `@mantine/schedule` filters an event by the hour and minute of its end without its date, and the
// next day's 00:00 reads as ending before the column begins. This draws the real component, so an
// upgrade of the package that changes that rule shows up here rather than on somebody's station.

import { describe, expect, it } from 'vitest';
import { DayView } from '@mantine/schedule';

import { drawnEnd } from '../../../src/components/schedule/schedule.edits';
import { render, screen } from '../../utils/render';

const LATE = { id: 'late', title: 'LateNite', color: 'blue', start: '2026-08-19 22:00:00' };

describe('the timetable grid', () => {
    it('drops a block ending at the next midnight as the API sends it', () => {
        render(<DayView date="2026-08-19" events={[{ ...LATE, end: '2026-08-20 00:00:00' }]} />);

        expect(screen.queryByText('LateNite')).not.toBeInTheDocument();
    });

    it('draws the same block once its end has been through drawnEnd', () => {
        render(<DayView date="2026-08-19" events={[{ ...LATE, end: drawnEnd(LATE.start, '2026-08-20 00:00:00') }]} />);

        expect(screen.getByText('LateNite')).toBeInTheDocument();
    });
});
