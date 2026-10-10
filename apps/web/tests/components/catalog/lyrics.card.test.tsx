import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { DateTime } from 'luxon';

import { LyricsCard } from '../../../src/components/catalog/lyrics.card';
import { render, screen } from '../../utils/render';

const getTrackLyrics = vi.fn();
const listTrackLyricsSources = vi.fn();

vi.mock('../../../src/api/client', () => ({
    BASE_URL: '/api',
    sdk: {
        catalog: {
            getTrackLyrics: (...args: unknown[]) => getTrackLyrics(...args),
            listTrackLyricsSources: (...args: unknown[]) => listTrackLyricsSources(...args),
        },
    },
}));

const TRACK_ID = '33333333-3333-4333-8333-333333333333';

afterEach(() => {
    vi.clearAllMocks();
});

describe('LyricsCard', () => {
    it('shows each timed line with its time, and which source they came from', async () => {
        getTrackLyrics.mockResolvedValue({
            trackId: TRACK_ID,
            kind: 'words',
            provider: 'deadair.lrclib',
            synced: [
                { atMs: 12_400, text: 'First sung line' },
                { atMs: 64_000, text: 'A later line' },
            ],
            language: 'en',
        });

        render(<LyricsCard trackId={TRACK_ID} />);

        expect(await screen.findByText('First sung line')).toBeInTheDocument();
        expect(screen.getByText('0:12')).toBeInTheDocument();
        expect(screen.getByText('1:04')).toBeInTheDocument();
        expect(screen.getByText('Timed')).toBeInTheDocument();
        expect(screen.getByText(/From deadair\.lrclib, in English/)).toBeInTheDocument();
        expect(getTrackLyrics).toHaveBeenCalledWith(TRACK_ID);
        // The sources are a second read, and nobody asked for them yet.
        expect(listTrackLyricsSources).not.toHaveBeenCalled();
    });

    it('shows untimed words as they came, line breaks kept', async () => {
        getTrackLyrics.mockResolvedValue({ trackId: TRACK_ID, kind: 'words', provider: 'deadair.lrclib', plain: 'One line\nAnother line' });

        render(<LyricsCard trackId={TRACK_ID} />);

        expect(await screen.findByText(/One line\s+Another line/)).toBeInTheDocument();
        expect(screen.getByText('Words only')).toBeInTheDocument();
        expect(screen.getByText('From deadair.lrclib')).toBeInTheDocument();
    });

    it('says when nobody sings on the record', async () => {
        getTrackLyrics.mockResolvedValue({ trackId: TRACK_ID, kind: 'instrumental', provider: 'deadair.lrclib' });

        render(<LyricsCard trackId={TRACK_ID} />);

        expect(await screen.findByText('Nobody sings on this record, according to deadair.lrclib.')).toBeInTheDocument();
    });

    it('says where lyrics come from when none have been found, and offers no sources', async () => {
        getTrackLyrics.mockResolvedValue({ trackId: TRACK_ID, kind: 'none' });

        render(<LyricsCard trackId={TRACK_ID} />);

        expect(await screen.findByText(/No lyrics have been found for this record yet/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Every source' })).not.toBeInTheDocument();
    });

    it('reports a failed read', async () => {
        getTrackLyrics.mockRejectedValue(new Error('boom'));

        render(<LyricsCard trackId={TRACK_ID} />);

        expect(await screen.findByText('Could not read the lyrics')).toBeInTheDocument();
    });

    it('reads every source only when asked, and says what each one holds', async () => {
        getTrackLyrics.mockResolvedValue({ trackId: TRACK_ID, kind: 'words', provider: 'deadair.lrclib', plain: 'Words' });
        listTrackLyricsSources.mockResolvedValue({
            trackId: TRACK_ID,
            sources: [
                { provider: 'deadair.lrclib', plain: 'Words', instrumental: false, fetchedAt: DateTime.fromISO('2026-10-01T12:00:00Z') },
                { provider: 'deadair.other', instrumental: true, fetchedAt: DateTime.fromISO('2026-09-20T12:00:00Z') },
            ],
        });

        render(<LyricsCard trackId={TRACK_ID} />);
        await userEvent.click(await screen.findByRole('button', { name: 'Every source' }));

        expect(await screen.findByText('deadair.other')).toBeInTheDocument();
        expect(screen.getByText('Nobody sings')).toBeInTheDocument();
        expect(screen.getAllByText(/^Found .*2026/)).toHaveLength(2);
        expect(listTrackLyricsSources).toHaveBeenCalledWith(TRACK_ID);
    });
});
