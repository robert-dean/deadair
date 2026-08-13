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

import { listenerLabel, OnAirBadge } from '../../../src/components/playout/on.air.badge';
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

    it('names an Icecast that stopped answering, which used to draw as `ready`', () => {
        // The pair the badge could not tell apart: same listener count, and one of them
        // is a station that will wait for a reading that is never going to arrive.
        render(<OnAirBadge silence={stationSilence('audienceUnknown')} />);

        expect(screen.getByText('audience unknown')).toBeInTheDocument();
        expect(screen.queryByText('ready')).not.toBeInTheDocument();
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
