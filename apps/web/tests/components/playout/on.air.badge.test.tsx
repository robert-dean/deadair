// The tally light has to tell apart the ways of not being on air, because they send
// an operator to different places: fix the stream, wait for a listener, or put
// something on. Collapsing any two of them is how a working station gets read as a
// broken one.
//
// It no longer works out WHICH — the station composes every gate and names the cause,
// and this only draws it. So what is worth testing here is the drawing: that a state
// which is not a fault is never coloured as one, and that the sentence on the badge is
// the station's rather than a second one invented in the console.

import { describe, expect, it } from 'vitest';

import { OnAirBadge } from '../../../src/components/playout/on.air.badge';
import { listenerLabel } from '../../../src/components/playout/silence.reading';
import { stationSilence } from '../../utils/playout.fixture';
import { render, screen } from '../../utils/render';

describe('OnAirBadge', () => {
    it('is on air when the station is holding the mount', () => {
        render(<OnAirBadge silence={stationSilence()} />);

        expect(screen.getByText('on air')).toBeInTheDocument();
    });

    it('is ready, not off air, when the only thing missing is a listener', () => {
        render(<OnAirBadge silence={stationSilence('noAudience')} />);

        expect(screen.getByText('ready')).toBeInTheDocument();
    });

    it('is off air when somebody stood the station down', () => {
        render(<OnAirBadge silence={stationSilence('stoodDown')} />);

        expect(screen.getByText('off air')).toBeInTheDocument();
    });

    it('names an unreachable stream', () => {
        render(<OnAirBadge silence={stationSilence('streamUnreachable')} />);

        expect(screen.getByText('stream unreachable')).toBeInTheDocument();
    });

    it('has a label for every gate the station can name', () => {
        // A missing one would render as blank, and a blank tally light is worse than a
        // wrong one: nothing about it says to look further.
        for (const cause of stationSilence().checks.map(check => check.code)) {
            const { unmount } = render(<OnAirBadge silence={stationSilence(cause)} />);
            expect(screen.getByText(/\w/)).toBeInTheDocument();
            unmount();
        }
    });

    it('labels a running order that ran out', () => {
        render(<OnAirBadge silence={stationSilence('noProgramme')} />);

        expect(screen.getByText('nothing to air')).toBeInTheDocument();
    });

    it('says a full running order is warming up rather than that it ran out', () => {
        // The two are the same silence and opposite facts: one wants an operator looking at why
        // refills are failing, and the other wants them to wait for a download.
        render(<OnAirBadge silence={stationSilence('warmingUp')} />);

        expect(screen.getByText('warming up')).toBeInTheDocument();
    });

    it('tells a station warming up apart from one whose records are not coming', () => {
        // Both are a full running order committing nothing, and only the second wants looking at.
        // One badge for both is how a station that had stopped fetching read as one that was busy.
        render(<OnAirBadge silence={stationSilence('waitingOnAudio')} />);

        expect(screen.getByText('records not here')).toBeInTheDocument();
    });
});

describe('listenerLabel', () => {
    it('names the empty room rather than showing a bare zero', () => {
        expect(listenerLabel(0)).toBe('nobody listening');
    });

    it('counts one listener in the singular', () => {
        expect(listenerLabel(1)).toBe('1 listening');
    });

    it('counts the rest in the plural', () => {
        expect(listenerLabel(42)).toBe('42 listening');
    });
});
