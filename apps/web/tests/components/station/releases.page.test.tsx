// What's new. Pinned: the release this station is running is marked, only the newest few are drawn
// until more are asked for, a release's Markdown is drawn as elements rather than as its raw text, and
// a build with no changelog says so rather than drawing an empty page.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StationRelease } from '@deadair/sdk';

import { RELEASES_SHOWN, ReleasesPage, formatReleaseDay } from '../../../src/components/station/releases.page';
import { render, screen, setupUser } from '../../utils/render';

const readStationReleases = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { station: { readStationReleases: () => readStationReleases() } },
}));

const release = (version: string, notes = `- Changed in **${version}**.`): StationRelease => ({
    version,
    date: '2026-09-23',
    notes,
});

afterEach(() => {
    readStationReleases.mockReset();
});

describe('ReleasesPage', () => {
    it('marks the release this station contains and draws its notes as Markdown', async () => {
        readStationReleases.mockResolvedValue({ current: '0.26.2', notes: [release('0.26.2'), release('0.26.1')] });

        render(<ReleasesPage />);

        expect(await screen.findByRole('heading', { name: '0.26.2' })).toBeInTheDocument();
        expect(screen.getByText('This station')).toBeInTheDocument();
        expect(screen.getAllByText('This station')).toHaveLength(1);
        expect(screen.getByText('0.26.1', { selector: 'strong' })).toBeInTheDocument();
        expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    });

    it('draws the newest few and the rest on request', async () => {
        const notes = Array.from({ length: RELEASES_SHOWN + 2 }, (_, index) => release(`0.${30 - index}.0`));
        readStationReleases.mockResolvedValue({ current: notes[0]!.version, notes });
        const user = setupUser();

        render(<ReleasesPage />);

        expect(await screen.findByRole('heading', { name: notes[0]!.version })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: notes[RELEASES_SHOWN]!.version })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Show 2 older releases' }));

        expect(screen.getByRole('heading', { name: notes[RELEASES_SHOWN + 1]!.version })).toBeInTheDocument();
    });

    it('says a release recorded nothing rather than drawing an empty card', async () => {
        readStationReleases.mockResolvedValue({ current: '0.2.2', notes: [release('0.2.2', '')] });

        render(<ReleasesPage />);

        expect(await screen.findByText('Nothing was recorded for this release.')).toBeInTheDocument();
    });

    it('says a build with no changelog has nothing to show', async () => {
        readStationReleases.mockResolvedValue({ notes: [] });

        render(<ReleasesPage />);

        expect(await screen.findByText(/carries no changelog/)).toBeInTheDocument();
    });
});

describe('formatReleaseDay', () => {
    it('keeps the day it was given in every zone, and passes through what is not a date', () => {
        expect(formatReleaseDay('2026-09-23')).toMatch(/23/);
        expect(formatReleaseDay('someday')).toBe('someday');
    });
});
