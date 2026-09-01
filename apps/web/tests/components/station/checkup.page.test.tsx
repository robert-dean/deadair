// The check-up assembles five readings, any one of which can be the thing that is broken. So what
// this file mostly pins is the degradation: one dead reader costs the page ONE section, never the
// screen, which is the whole reason a page like this is worth having.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

import { CheckupPage, silenceTone } from '../../../src/components/station/checkup.page';
import { stubPhoneMedia } from '../../utils/phone';
import { playoutStatus, stationSilence } from '../../utils/playout.fixture';
import { render, screen, within } from '../../utils/render';

const getPlayoutStatus = vi.fn();
const readStationAttention = vi.fn();
const readStationCheckup = vi.fn();
const listPlugins = vi.fn();
const readStorage = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        playout: { getPlayoutStatus: () => getPlayoutStatus() },
        station: { readStationAttention: () => readStationAttention(), readStationCheckup: () => readStationCheckup() },
        plugins: { listPlugins: () => listPlugins() },
        storage: { readStorage: () => readStorage() },
    },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...rest }: { to?: string; children?: ReactNode }) => (
        <a href={to} {...rest}>
            {children}
        </a>
    ),
}));

const checkup = () => ({
    readAt: '2026-08-25T12:00:00.000Z',
    heartbeats: [
        { name: 'playout.reconcile', startedAt: '2026-08-25T11:00:00.000Z', lastBeat: '2026-08-25T11:59:55.000Z' },
        { name: 'audience.poll', startedAt: '2026-08-25T11:00:00.000Z' },
    ],
    backlog: { total: 581, cached: 570, measured: 13 },
});

/** Everything answering, so a case can break exactly one thing and say what happened. */
function allWell() {
    getPlayoutStatus.mockResolvedValue(playoutStatus());
    readStationAttention.mockResolvedValue({ items: [] });
    readStationCheckup.mockResolvedValue(checkup());
    listPlugins.mockResolvedValue([]);
    readStorage.mockResolvedValue({ readAt: '2026-08-25T12:00:00.000Z', stores: [] });
}

afterEach(() => {
    vi.resetAllMocks();
});

describe('CheckupPage', () => {
    it('assembles the machinery in one place', async () => {
        allWell();

        render(<CheckupPage />);

        expect(await screen.findByText('playout.reconcile')).toBeInTheDocument();
        expect(screen.getByText('581')).toBeInTheDocument();
    });

    it('lists every mount the station publishes, not just the one it is named by', async () => {
        allWell();
        getPlayoutStatus.mockResolvedValue(
            playoutStatus({
                mounts: [
                    { format: 'mp3', path: '/live.mp3', bitrateKbps: 128 },
                    { format: 'opus', path: '/live.opus', bitrateKbps: 160 },
                    { format: 'flac', path: '/live.flac' },
                ],
            }),
        );

        render(<CheckupPage />);

        expect(await screen.findByText('/live.opus')).toBeInTheDocument();
        expect(screen.getByText('/live.flac')).toBeInTheDocument();
        expect(screen.getByText('160 kbps')).toBeInTheDocument();
        // FLAC has no bitrate to report, and that is a fact about the format rather than a
        // figure nobody filled in, so it says so instead of leaving a gap.
        expect(screen.getByText('lossless')).toBeInTheDocument();
    });

    /**
     * A loop that has registered and never finished a pass is a different fact from one that
     * stopped, which is why the contract carries `startedAt` beside `lastBeat`.
     */
    it('says when a loop has never completed a pass rather than showing a dash', async () => {
        allWell();

        render(<CheckupPage />);
        await screen.findByText('audience.poll');

        const row = screen.getByText('audience.poll').closest('tr');
        expect(within(row as HTMLElement).getByText('not yet')).toBeInTheDocument();
    });

    // On a phone the loops table becomes cards, and the two ages fold into one fact line that
    // keeps both facts — including the never-passed one, which stays distinct from a stopped loop.
    it('gives a phone the loops as cards with the ages folded into one line', async () => {
        const restore = stubPhoneMedia();
        try {
            allWell();

            render(<CheckupPage />);

            expect(await screen.findByText('playout.reconcile')).toBeInTheDocument();
            expect(screen.getByText('last pass 5s ago · started 1h ago')).toBeInTheDocument();
            expect(screen.getByText('no pass yet · started 1h ago')).toBeInTheDocument();
            expect(screen.getByText('audience.poll').closest('tr')).toBeNull();
        } finally {
            restore();
        }
    });

    /**
     * `Heartbeat` refuses to say what "too long" means, because a five-second reconcile and a nightly
     * sweep are both healthy. A page that painted one red would be picking the number the station
     * deliberately did not.
     */
    it('reports the age of a loop without judging it', async () => {
        allWell();

        render(<CheckupPage />);

        // Five seconds before the reading was taken, stated as an age and nothing else.
        expect(await screen.findByText('5s ago')).toBeInTheDocument();
    });

    it('loses one section rather than the page when a reading fails', async () => {
        allWell();
        readStorage.mockRejectedValue(new Error('the disk could not be walked'));

        render(<CheckupPage />);

        expect(await screen.findByText('This could not be read. The rest of the page is unaffected.')).toBeInTheDocument();
        // Everything else still answers.
        expect(screen.getByText('playout.reconcile')).toBeInTheDocument();
        expect(screen.getByText('581')).toBeInTheDocument();
    });

    /**
     * Absent is not empty. The service drops a section it could not read, and a page that drew that
     * as "nothing is running" would report a broken reader as a stopped station.
     */
    it('tells a section it could not read from one with nothing in it', async () => {
        allWell();
        readStationCheckup.mockResolvedValue({ readAt: '2026-08-25T12:00:00.000Z' });

        render(<CheckupPage />);

        expect(await screen.findByText('The station could not say what its loops are doing.')).toBeInTheDocument();
        expect(screen.getByText('The catalog could not be counted.')).toBeInTheDocument();
    });

    /**
     * The question this section exists to answer: "is the station running what I committed", asked
     * without a shell on the host. The image stamps the commit and the console reads it back.
     */
    it('says which commit the station was built from, short to read and whole to copy', async () => {
        allWell();
        readStationCheckup.mockResolvedValue({ ...checkup(), revision: 'a518ad85c82e33e7f535afb067bb6e6f22e9eb11' });

        render(<CheckupPage />);

        // Seven characters is what gets compared against `git log` by eye.
        expect(await screen.findByText('a518ad8')).toBeInTheDocument();
        // And the whole of it is what gets pasted back into one, which is what the copy button
        // carries and the title attribute shows.
        expect(screen.getByTitle('a518ad85c82e33e7f535afb067bb6e6f22e9eb11')).toBeInTheDocument();
    });

    /**
     * The one field on this contract where absent does NOT mean a reader failed. A development tree
     * has no commit to report, and drawing that as a broken section would report the ordinary case
     * as a fault.
     */
    it('says an unstamped build was not built from a commit, rather than drawing it as a failure', async () => {
        allWell();

        render(<CheckupPage />);

        expect(
            await screen.findByText('This station was not built from a commit, which is what a development tree and a hand-built image both are.'),
        ).toBeInTheDocument();
        // The section is present and answering, not one of the boxes that could not be read.
        expect(screen.queryByText('This could not be read. The rest of the page is unaffected.')).not.toBeInTheDocument();
    });

    it('shows the station’s own verdict rather than wording a second one', async () => {
        allWell();
        getPlayoutStatus.mockResolvedValue(playoutStatus({ silence: stationSilence('noAudience') }));

        render(<CheckupPage />);

        expect(await screen.findByText('noAudience')).toBeInTheDocument();
    });
});

/**
 * The one judgement this page makes for itself, tested as the function it is.
 *
 * A station idling for want of a listener is the audience gate working and a station somebody stood
 * down is somebody's decision. Painting either red is the failure the `ready` badge exists to avoid,
 * and asserting it through a rendered colour is how a test passes while saying nothing.
 */
describe('silenceTone', () => {
    it('leaves the states that are the station doing as it was told unpainted', () => {
        expect(silenceTone('noAudience')).toBe('standby');
        expect(silenceTone('warmingUp')).toBe('standby');
        expect(silenceTone('noProgramme')).toBe('standby');
        expect(silenceTone('stoodDown')).toBe('off');
    });

    it('and paints the ones that actually want fixing', () => {
        expect(silenceTone('streamUnreachable')).toBe('fault');
        expect(silenceTone('transportStalled')).toBe('fault');
        expect(silenceTone('controlDenied')).toBe('fault');
    });
});
