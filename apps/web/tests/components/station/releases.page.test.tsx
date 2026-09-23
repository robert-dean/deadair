// What's new. Pinned: the release this station is running is marked, only the newest few are drawn
// until more are asked for, a release's Markdown is drawn as elements rather than as its raw text, a
// build with no changelog says so rather than drawing an empty page, a newer release is drawn first
// and set apart, and "not looking" is said rather than left to read as "nothing newer".

import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import type { StationRelease } from '@deadair/sdk';

import { RELEASES_SHOWN, ReleasesPage, checkOutcome } from '../../../src/components/station/releases.page';
import { render, screen, setupUser } from '../../utils/render';

const readStationReleases = vi.fn();
const checkStationReleases = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: { station: { readStationReleases: () => readStationReleases(), checkStationReleases: () => checkStationReleases() } },
}));

vi.mock('@tanstack/react-router', () => ({
    Link: ({ to, children, ...rest }: { to?: string; children?: ReactNode }) => (
        <a href={to} {...rest}>
            {children}
        </a>
    ),
}));

/** An answer from a station that has checked and heard of nothing newer, over the given notes. */
const answer = (over: Record<string, unknown>) => ({ checks: true, available: [], notes: [], ...over });

const release = (version: string, notes = `- Changed in **${version}**.`): StationRelease => ({
    version,
    date: DateTime.fromFormat('2026-09-23', 'yyyy-MM-dd'),
    notes,
});

afterEach(() => {
    readStationReleases.mockReset();
    checkStationReleases.mockReset();
});

describe('ReleasesPage', () => {
    it('marks the release this station contains and draws its notes as Markdown', async () => {
        readStationReleases.mockResolvedValue(answer({ current: '0.26.2', notes: [release('0.26.2'), release('0.26.1')] }));

        render(<ReleasesPage />);

        expect(await screen.findByRole('heading', { name: '0.26.2' })).toBeInTheDocument();
        expect(screen.getByText('This station')).toBeInTheDocument();
        expect(screen.getAllByText('This station')).toHaveLength(1);
        // The day the SDK read is the day drawn, in whatever zone the browser is in. A UTC midnight
        // formatted west of Greenwich would show the 22nd.
        expect(screen.getAllByText(/\b23\b/).length).toBeGreaterThan(0);
        expect(screen.queryByText(/\b22\b/)).not.toBeInTheDocument();
        expect(screen.getByText('0.26.1', { selector: 'strong' })).toBeInTheDocument();
        expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
    });

    it('draws the newest few and the rest on request', async () => {
        const notes = Array.from({ length: RELEASES_SHOWN + 2 }, (_, index) => release(`0.${30 - index}.0`));
        readStationReleases.mockResolvedValue(answer({ current: notes[0]!.version, notes }));
        const user = setupUser();

        render(<ReleasesPage />);

        expect(await screen.findByRole('heading', { name: notes[0]!.version })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: notes[RELEASES_SHOWN]!.version })).not.toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Show 2 older releases' }));

        expect(screen.getByRole('heading', { name: notes[RELEASES_SHOWN + 1]!.version })).toBeInTheDocument();
    });

    it('says a release recorded nothing rather than drawing an empty card', async () => {
        readStationReleases.mockResolvedValue(answer({ current: '0.2.2', notes: [release('0.2.2', '')] }));

        render(<ReleasesPage />);

        expect(await screen.findByText('Nothing was recorded for this release.')).toBeInTheDocument();
    });

    it('says a build with no changelog has nothing to show', async () => {
        readStationReleases.mockResolvedValue(answer({}));

        render(<ReleasesPage />);

        expect(await screen.findByText(/carries no changelog/)).toBeInTheDocument();
    });
});

describe('ReleasesPage, with a newer release out', () => {
    it('draws it first, marked as not installed, with its page', async () => {
        readStationReleases.mockResolvedValue(
            answer({
                current: '0.26.2',
                notes: [release('0.26.2')],
                available: [{ ...release('0.27.0'), url: 'https://github.com/robert-dean/deadair/releases/tag/v0.27.0' }],
                checkedAt: DateTime.fromISO('2026-09-24T12:00:00.000Z'),
            }),
        );

        render(<ReleasesPage />);

        const headings = await screen.findAllByRole('heading', { level: 3 });
        expect(headings.map(heading => heading.textContent)).toEqual(['0.27.0', '0.26.2']);
        expect(screen.getByText('Not installed')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Release page' })).toHaveAttribute(
            'href',
            'https://github.com/robert-dean/deadair/releases/tag/v0.27.0',
        );
        expect(screen.getByText(/last heard back/)).toBeInTheDocument();
    });
});

describe('ReleasesPage, on whether it is looking', () => {
    it('says the check is off and where to turn it on', async () => {
        readStationReleases.mockResolvedValue(answer({ current: '0.26.2', notes: [release('0.26.2')], checks: false }));

        render(<ReleasesPage />);

        expect(await screen.findByText(/not checking for newer releases/)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Settings, Station' })).toHaveAttribute('href', '/settings/station');
    });

    it('says it has not heard back yet rather than implying nothing is newer', async () => {
        readStationReleases.mockResolvedValue(answer({ current: '0.26.2', notes: [release('0.26.2')] }));

        render(<ReleasesPage />);

        expect(await screen.findByText(/has not heard back yet/)).toBeInTheDocument();
    });
});

describe('ReleasesPage, Check now', () => {
    it('asks the station, then draws what it found everywhere the reading is used', async () => {
        readStationReleases.mockResolvedValue(
            answer({ current: '0.26.2', notes: [release('0.26.2')], checkedAt: DateTime.now().minus({ hours: 5 }) }),
        );
        checkStationReleases.mockResolvedValue(
            answer({
                current: '0.26.2',
                notes: [release('0.26.2')],
                checkedAt: DateTime.now(),
                available: [{ ...release('0.27.0'), url: 'https://github.com/robert-dean/deadair/releases/tag/v0.27.0' }],
            }),
        );
        const user = setupUser();

        render(<ReleasesPage />);
        await user.click(await screen.findByRole('button', { name: 'Check now' }));

        expect(await screen.findByRole('status')).toHaveTextContent('deadair 0.27.0 is out.');
        expect(checkStationReleases).toHaveBeenCalledOnce();
        expect(screen.getByRole('heading', { name: '0.27.0' })).toBeInTheDocument();
    });

    it('is not offered while the check is off', async () => {
        readStationReleases.mockResolvedValue(answer({ current: '0.26.2', notes: [release('0.26.2')], checks: false }));

        render(<ReleasesPage />);

        expect(await screen.findByText(/not checking for newer releases/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Check now' })).not.toBeInTheDocument();
    });

    it('shows the station’s refusal to somebody who may not ask', async () => {
        readStationReleases.mockResolvedValue(answer({ current: '0.26.2', notes: [release('0.26.2')] }));
        checkStationReleases.mockRejectedValue(new Error('Forbidden'));
        const user = setupUser();

        render(<ReleasesPage />);
        await user.click(await screen.findByRole('button', { name: 'Check now' }));

        expect(await screen.findByText('Could not check for new releases')).toBeInTheDocument();
    });
});

describe('checkOutcome', () => {
    const now = DateTime.fromISO('2026-09-24T12:00:00.000Z');
    const reading = (over: Record<string, unknown>) => answer({ current: '0.26.2', checkedAt: now.minus({ seconds: 5 }), ...over }) as never;

    it('says nothing newer is out when GitHub answered with nothing', () => {
        expect(checkOutcome(reading({}), now)).toBe('Nothing newer than 0.26.2 is out.');
    });

    it('names the newest release, and counts them when there are several', () => {
        expect(checkOutcome(reading({ available: [release('0.27.0')] }), now)).toBe('deadair 0.27.0 is out.');
        expect(checkOutcome(reading({ available: [release('0.28.0'), release('0.27.0')] }), now)).toBe(
            '2 newer releases are out, the newest 0.28.0.',
        );
    });

    it('says GitHub did not answer when the answer is an old one, or there is none', () => {
        expect(checkOutcome(reading({ checkedAt: now.minus({ hours: 3 }) }), now)).toMatch(/did not answer/);
        expect(checkOutcome(reading({ checkedAt: undefined }), now)).toMatch(/did not answer/);
    });
});
