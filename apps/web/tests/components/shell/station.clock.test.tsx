import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StationClock } from '../../../src/components/shell/station.clock';
import { render, screen } from '../../utils/render';

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

        expect(screen.getByLabelText('Station clock')).toHaveTextContent('22:41:09');
    });
});
