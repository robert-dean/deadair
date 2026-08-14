// The panel decides nothing: every state, sentence and ordering comes from the API,
// because the console working any of it out is the problem the field was added to fix.
// So what is tested here is what it does with an answer — that a state which is not a
// fault is not drawn as one, that the fault the station is NOT blaming still gets said,
// and that "ruled out" is present, which is the whole reason this is a panel rather than
// a bigger tooltip.

import { describe, expect, it } from 'vitest';

import { SilenceDiagnosisPanel } from '../../../src/components/playout/silence.diagnosis.panel';
import { stationSilence } from '../../utils/playout.fixture';
import { render, screen } from '../../utils/render';

/** One container behind, as a check on the reading rather than as the cause. */
const staleConfigCheck = (silence = stationSilence()) => ({
    ...silence,
    checks: silence.checks.map(check =>
        check.code === 'configNotAdopted'
            ? {
                  ...check,
                  state: 'fault' as const,
                  detail: 'icecast is running config the app has replaced.',
                  remedy: 'docker compose restart icecast',
              }
            : check,
    ),
});

describe('SilenceDiagnosisPanel', () => {
    it('says the station is on air when nothing is blocking', () => {
        render(<SilenceDiagnosisPanel silence={stationSilence()} />);

        expect(screen.getByText('The station is on air')).toBeInTheDocument();
    });

    it('names the blocking gate and carries the remedy the station gave', () => {
        render(<SilenceDiagnosisPanel silence={stationSilence('streamUnreachable', { remedy: 'Check that the icecast container is running.' })} />);

        expect(screen.getByText('The stream is not reachable')).toBeInTheDocument();
        expect(screen.getByText('Check that the icecast container is running.')).toBeInTheDocument();
    });

    it('lists what it ruled out', () => {
        render(<SilenceDiagnosisPanel silence={stationSilence('noProgramme')} />);

        expect(screen.getByText('Ruled out')).toBeInTheDocument();
        expect(screen.getByText('The stream is not reachable')).toBeInTheDocument();
    });

    it('reports a replaced config even on a station that is airing', () => {
        // It is never the cause, because a station can air perfectly well to somebody who
        // connected before the config was replaced. It is still the reason the next
        // listener will be refused, so it cannot be swallowed by an "on air" panel.
        render(<SilenceDiagnosisPanel silence={staleConfigCheck()} />);

        expect(screen.getByText('A container is running config that was replaced')).toBeInTheDocument();
    });

    it('offers the restart as a command to copy rather than a button that would be a lie', () => {
        // The app cannot restart a sibling container: it has no Docker socket and should
        // not have one. The deliverable is the command.
        render(<SilenceDiagnosisPanel silence={staleConfigCheck()} />);

        expect(screen.getByText('docker compose restart icecast')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    });

    it('reports the blocking gate and the unrelated fault separately', () => {
        render(<SilenceDiagnosisPanel silence={staleConfigCheck(stationSilence('streamUnreachable'))} />);

        expect(screen.getByText('The stream is not reachable')).toBeInTheDocument();
        expect(screen.getByText('A container is running config that was replaced')).toBeInTheDocument();
    });
});
