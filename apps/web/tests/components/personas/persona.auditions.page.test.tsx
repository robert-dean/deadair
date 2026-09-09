// An audition fills in over minutes, so most of what this page has to get right is how it behaves
// while there is nothing to read yet: a queued run must not look like a failure, a run with no
// breaks must not offer to open, and the thing an operator came for — the model-versus-floor tally —
// only exists once the breaks have been fetched.
//
// The other half is the pair of pickers. A caller is cast into a production and never presents, so
// offering one here would be measuring something the station will never ask it to do.

import { describe, expect, it, vi } from 'vitest';
import type { PersonaAudition, PersonaAuditionSummary } from '@deadair/sdk';

import { PersonaAuditionsPage } from '../../../src/components/personas/persona.auditions.page';
import { render, screen } from '../../utils/render';

const summary = (over: Partial<PersonaAuditionSummary> = {}): PersonaAuditionSummary =>
    ({
        id: 'a1',
        personaId: 'p1',
        personaKey: 'classic',
        source: { pluginId: 'spotify', playlistId: 'pl1', name: 'Late night' },
        state: 'done',
        transitions: 2,
        written: 2,
        createdAt: '2026-09-08T21:00:00.000Z',
        ...over,
    }) as unknown as PersonaAuditionSummary;

const run = (over: Partial<PersonaAudition> = {}): PersonaAudition =>
    ({
        ...summary(),
        breaks: [
            {
                ordinal: 0,
                previous: { title: 'Green Onions', artist: 'Booker T. & the M.G.s' },
                next: { title: 'Ain’t No Sunshine', artist: 'Bill Withers' },
                attempts: [{ writer: 'model', outcome: 'written', durationMs: 900, script: 'That was Green Onions.' }],
                script: 'That was Green Onions.',
                writer: 'model',
            },
            {
                ordinal: 1,
                previous: { title: 'Ain’t No Sunshine', artist: 'Bill Withers' },
                next: { title: 'Move On Up', artist: 'Curtis Mayfield' },
                attempts: [
                    { writer: 'model', outcome: 'declined', durationMs: 40, reason: 'it named no record' },
                    { writer: 'deterministic', outcome: 'written', durationMs: 1, script: 'Bill Withers there.' },
                ],
                script: 'Bill Withers there.',
                writer: 'deterministic',
            },
        ],
        ...over,
    }) as unknown as PersonaAudition;

const listed: PersonaAuditionSummary[] = [];
let detail: PersonaAudition = run();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        personas: {
            listPersonas: () =>
                Promise.resolve({
                    personas: [
                        { id: 'p1', key: 'classic', kind: 'host', label: 'Classic host', style: 'a classic host', active: true },
                        { id: 'p2', key: 'theorist', kind: 'caller', label: 'The theorist', style: 'a caller', active: false },
                    ],
                }),
            listPersonaAuditions: () => Promise.resolve({ auditions: listed }),
            getPersonaAudition: () => Promise.resolve(detail),
        },
        playlists: {
            listImportablePlaylists: () =>
                Promise.resolve({ playlists: [{ pluginId: 'spotify', pluginName: 'Spotify', id: 'pl1', name: 'Late night' }], errors: [] }),
        },
    },
}));

const show = (...runs: PersonaAuditionSummary[]) => {
    listed.splice(0, listed.length, ...runs);
    render(<PersonaAuditionsPage />);
};

describe('the audition page', () => {
    it('offers the hosts and not the callers', async () => {
        show();

        // A caller is cast into a production and never presents.
        expect(await screen.findByDisplayValue('Classic host (on air)')).toBeInTheDocument();
        expect(screen.queryByDisplayValue('The theorist')).not.toBeInTheDocument();
    });

    it('says a character has not been auditioned rather than showing an empty list', async () => {
        show();

        expect(await screen.findByText(/has not been auditioned yet/)).toBeInTheDocument();
    });

    it('draws a queued run as waiting rather than as a failure', async () => {
        show(summary({ state: 'queued', written: 0, transitions: 10 }));

        expect(await screen.findByText('Waiting for the model')).toBeInTheDocument();
        expect(await screen.findByText(/fills in slowly/)).toBeInTheDocument();
    });

    it('shows how far along a run is while it writes', async () => {
        show(summary({ state: 'running', written: 3, transitions: 10 }));

        expect(await screen.findByText('3 / 10')).toBeInTheDocument();
        expect(await screen.findByText('Writing')).toBeInTheDocument();
    });

    it('names the playlist a run was written against', async () => {
        show(summary());

        expect(await screen.findByText(/Late night/)).toBeInTheDocument();
    });

    it('offers to stop a run that is still going', async () => {
        show(summary({ state: 'running', written: 1 }));

        expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });

    it('does not offer to stop one that has finished', async () => {
        show(summary({ state: 'done' }));

        // What it wrote, it wrote. Stopping something that is over would be a button that rewrites
        // the record rather than one that changes anything.
        expect(await screen.findByRole('button', { name: 'Read' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
    });

    it('will not open a run that has written nothing yet', async () => {
        show(summary({ state: 'queued', written: 0 }));

        expect(await screen.findByRole('button', { name: 'Read' })).toBeDisabled();
    });

    it('reads the transitions when a run is opened', async () => {
        detail = run();
        show(summary());

        (await screen.findByRole('button', { name: 'Read' })).click();

        expect(await screen.findByText('between Green Onions and Ain’t No Sunshine')).toBeInTheDocument();
        expect(await screen.findByText('That was Green Onions.')).toBeInTheDocument();
    });

    it('shows the writer that declined beside the floor that covered for it', async () => {
        detail = run();
        show(summary());

        (await screen.findByRole('button', { name: 'Read' })).click();

        // The pair is the interesting reading: the winner alone would make a sheet whose markers are
        // impossible look exactly like a station with no model.
        expect(await screen.findByText('it named no record')).toBeInTheDocument();
        expect(await screen.findByText('Bill Withers there.')).toBeInTheDocument();
    });

    it('tallies how much of the run the model actually wrote', async () => {
        detail = run();
        show(summary());

        (await screen.findByRole('button', { name: 'Read' })).click();

        // The number the whole feature exists to produce, before anything airs rather than an
        // evening after.
        expect(await screen.findByText('1 by the model')).toBeInTheDocument();
        expect(await screen.findByText('1 declined')).toBeInTheDocument();
    });

    it('says why a run stopped, when something stopped it', async () => {
        show(summary({ state: 'failed', error: 'the model host is unreachable' }));

        expect(await screen.findByText('the model host is unreachable')).toBeInTheDocument();
        expect(await screen.findByText('Stopped by a fault')).toBeInTheDocument();
    });
});
