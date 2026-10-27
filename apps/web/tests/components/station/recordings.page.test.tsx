// Recordings. Pinned: a show is drawn by its title and an hour by what it is, a recording still being
// written says so and cannot be deleted, the player and the download point at the signed URL the API
// listed, delete takes two presses, and an archive that is off says how to switch it on.

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { Recording, RecordingList } from '@deadair/sdk';

import { RecordingsPage } from '../../../src/components/station/recordings.page';
import { render, screen, setupUser } from '../../utils/render';

const listRecordings = vi.fn();
const deleteRecording = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: { stream: { archive: { listRecordings: () => listRecordings(), deleteRecording: (id: string) => deleteRecording(id) } } },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...rest }: { to?: string; children?: ReactNode }) => (
        <a href={to} {...rest}>
            {children}
        </a>
    ),
}));

const show: Recording = {
    id: '2026-10-27T21-03-12-live',
    kind: 'live',
    title: 'Pirate Hour',
    startedAt: DateTime.fromISO('2026-10-27T21:03:12'),
    endedAt: DateTime.fromISO('2026-10-27T22:00:00'),
    bytes: 82_000_000,
    recording: false,
    audioUrl: '/archive/recordings/2026-10-27T21-03-12-live/audio?t=123.abc',
};

const hour: Recording = {
    id: '2026-10-27T22-00-00-hour',
    kind: 'hour',
    startedAt: DateTime.fromISO('2026-10-27T22:00:00'),
    bytes: 1_000_000,
    recording: true,
    audioUrl: '/archive/recordings/2026-10-27T22-00-00-hour/audio?t=456.def',
};

const answer = (over: Partial<RecordingList> = {}): RecordingList => ({ mode: 'all', retentionDays: 14, recordings: [hour, show], ...over });

afterEach(() => {
    listRecordings.mockReset();
    deleteRecording.mockReset();
});

describe('RecordingsPage', () => {
    it('draws a show by its title and an hour by what it is, with what the archive is set to keep', async () => {
        listRecordings.mockResolvedValue(answer());

        render(<RecordingsPage />);

        expect(await screen.findByText('Pirate Hour')).toBeInTheDocument();
        expect(screen.getByText('The station’s programme')).toBeInTheDocument();
        expect(screen.getByText('Recording everything on air')).toBeInTheDocument();
        expect(screen.getByText('Kept for 14 days after they end')).toBeInTheDocument();
    });

    it('says a recording is still being written, and offers no delete for it', async () => {
        listRecordings.mockResolvedValue(answer({ recordings: [hour] }));

        render(<RecordingsPage />);

        expect(await screen.findByText('Recording now')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    });

    it('downloads and plays from the signed URL the station listed', async () => {
        listRecordings.mockResolvedValue(answer({ recordings: [show] }));
        const user = setupUser();

        const { container } = render(<RecordingsPage />);

        const download = await screen.findByRole('link', { name: 'Download' });
        expect(download).toHaveAttribute('href', '/api/archive/recordings/2026-10-27T21-03-12-live/audio?t=123.abc&download=true');

        await user.click(screen.getByRole('button', { name: 'Play' }));
        expect(container.querySelector('audio')).toHaveAttribute('src', '/api/archive/recordings/2026-10-27T21-03-12-live/audio?t=123.abc');
    });

    it('deletes only on the second press', async () => {
        listRecordings.mockResolvedValue(answer({ recordings: [show] }));
        deleteRecording.mockResolvedValue(undefined);
        const user = setupUser();

        render(<RecordingsPage />);

        await user.click(await screen.findByRole('button', { name: 'Delete' }));
        expect(deleteRecording).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: 'Delete for good?' }));
        expect(deleteRecording).toHaveBeenCalledWith(show.id);
    });

    it('says how to switch the archive on when it is off and empty', async () => {
        listRecordings.mockResolvedValue(answer({ mode: 'off', recordings: [] }));

        render(<RecordingsPage />);

        const link = await screen.findByRole('link', { name: 'Record what airs' });
        expect(link).toHaveAttribute('href', '/settings/stream');
        expect(screen.getByText('Not recording')).toBeInTheDocument();
    });
});
