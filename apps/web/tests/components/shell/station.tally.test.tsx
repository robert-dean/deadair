// The tally is the one object on the console an operator trusts without reading, and it now sits
// in the chrome on every page. So what is worth testing is the two ways a permanent reading can
// lie: claiming a state before it has one, and drawing a station that is merely waiting as a
// station that is broken.

import { describe, expect, it } from 'vitest';

import { StationTally } from '../../../src/components/shell/station.tally';
import { playoutStatus, stationSilence } from '../../utils/playout.fixture';
import { render, screen } from '../../utils/render';

describe('StationTally', () => {
    it('claims no state at all before the first reading arrives', () => {
        // Not "off air", which is a claim. A pill that says the station is down because a request
        // is in flight is worse than the gap where it is about to be.
        render(<StationTally />);

        expect(screen.queryByLabelText(/^Status:/)).not.toBeInTheDocument();
        expect(screen.queryByText(/listening/)).not.toBeInTheDocument();
    });

    it('says the station is on air, who is listening and where it is going', () => {
        render(<StationTally status={playoutStatus({ listeners: 3, mountPath: '/deadair.mp3' })} />);

        expect(screen.getByText('on air')).toBeInTheDocument();
        expect(screen.getByText('3 listening')).toBeInTheDocument();
        expect(screen.getByText('/deadair.mp3')).toBeInTheDocument();
    });

    it('names the empty room rather than showing a bare zero', () => {
        render(<StationTally status={playoutStatus({ listeners: 0, silence: stationSilence('noAudience') })} />);

        expect(screen.getByText('nobody listening')).toBeInTheDocument();
    });

    it('is ready, not off air, when the only thing missing is a listener', () => {
        // The pair this whole vocabulary exists to keep apart: waiting for somebody to tune in is
        // the resting state of an audience-gated station, and drawing it as a fault is what made a
        // working station read as a broken one.
        render(<StationTally status={playoutStatus({ listeners: 0, silence: stationSilence('noAudience') })} />);

        expect(screen.getByText('ready')).toBeInTheDocument();
        expect(screen.queryByText('off air')).not.toBeInTheDocument();
    });

    it('labels an unreachable stream as the fault it is', () => {
        render(<StationTally status={playoutStatus({ silence: stationSilence('streamUnreachable') })} />);

        expect(screen.getByText('stream unreachable')).toBeInTheDocument();
        expect(screen.getByLabelText('Status: stream unreachable')).toBeInTheDocument();
    });
});
