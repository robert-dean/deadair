import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StationClock } from '../../../src/components/shell/station.clock';
import { render, screen, waitFor } from '../../utils/render';

const readCurrentSlot = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { schedule: { readCurrentSlot: () => readCurrentSlot() } },
}));

/** Whatever zone this machine runs the suite in, so "the same as the operator's" holds anywhere. */
const HERE = Intl.DateTimeFormat().resolvedOptions().timeZone;

beforeEach(() => {
    readCurrentSlot.mockResolvedValue({ now: '2026-08-15 22:41:07', timezone: HERE, upcoming: [] });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-15T22:41:07'));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('StationClock', () => {
    it('shows local wall time down to the second', () => {
        render(<StationClock />);

        expect(screen.getByLabelText('Station clock')).toHaveTextContent('22:41:07');
    });

    it('keeps up with the wall clock', async () => {
        render(<StationClock />);

        await vi.advanceTimersByTimeAsync(2_000);

        // Waited for rather than read once. Advancing the timers fires the interval, but the render
        // it causes lands on React's own schedule, and under a loaded suite that is not always
        // within the same turn — which showed up as the clock still reading its mounted value and
        // looked like a component that had stopped ticking.
        await waitFor(() => expect(screen.getByLabelText('Station clock')).toHaveTextContent('22:41:09'));
    });

    it('adds nothing when the station keeps the same time as the operator', async () => {
        render(<StationClock />);

        await waitFor(() => expect(readCurrentSlot).toHaveBeenCalled());
        expect(screen.queryByLabelText('The time where the station is')).not.toBeInTheDocument();
    });

    it('shows the station time beside it when the station is somewhere else', async () => {
        // Fourteen hours ahead of UTC, which no machine running this suite is.
        readCurrentSlot.mockResolvedValue({ now: '2026-08-16 12:41:07', timezone: 'Pacific/Kiritimati', upcoming: [] });
        render(<StationClock />);

        const station = await screen.findByLabelText('The time where the station is');
        expect(station).toHaveTextContent(/^station \d{2}:\d{2}$/);
    });

    it('shows nothing extra for a zone this browser does not know, rather than breaking the header', async () => {
        readCurrentSlot.mockResolvedValue({ now: '2026-08-15 22:41:07', timezone: 'Europe/Lundon', upcoming: [] });
        render(<StationClock />);

        await waitFor(() => expect(readCurrentSlot).toHaveBeenCalled());
        expect(screen.getByLabelText('Station clock')).toHaveTextContent('22:41:07');
        expect(screen.queryByLabelText('The time where the station is')).not.toBeInTheDocument();
    });
});
