import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StationClock } from '../../../src/components/shell/station.clock';
import { render, screen, waitFor } from '../../utils/render';

beforeEach(() => {
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
});
