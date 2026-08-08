// The tally light has to tell apart three ways of not being on air, because they
// send an operator to three different places: fix the stream, wait for a listener,
// or put something on. Collapsing any two of them is how a working station gets
// read as a broken one.

import { describe, expect, it } from 'vitest';

import { listenerLabel, OnAirBadge } from '../../../src/components/playout/on.air.badge';
import { playoutStatus } from '../../utils/playout.fixture';
import { render, screen } from '../../utils/render';

describe('OnAirBadge', () => {
    it('is on air when the station is holding the mount', () => {
        render(<OnAirBadge status={playoutStatus()} />);

        expect(screen.getByText('on air')).toBeInTheDocument();
    });

    it('is ready, not off air, when the only thing missing is a listener', () => {
        render(<OnAirBadge status={playoutStatus({ onAir: false, audience: false, listeners: 0 })} />);

        expect(screen.getByText('ready')).toBeInTheDocument();
    });

    it('is off air when there is nothing to play either', () => {
        render(
            <OnAirBadge status={playoutStatus({ onAir: false, audience: false, listeners: 0, nowPlaying: undefined, upNext: [], queuedCount: 0 })} />,
        );

        expect(screen.getByText('off air')).toBeInTheDocument();
    });

    it('reports an unreachable stream ahead of anything about the audience', () => {
        // Nothing could air for anybody, so the audience is not the explanation.
        render(<OnAirBadge status={playoutStatus({ streamUp: false, onAir: false, audience: false, listeners: 0 })} />);

        expect(screen.getByText('stream unreachable')).toBeInTheDocument();
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
