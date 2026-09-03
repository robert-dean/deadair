// What the traces page owes a phone: the same forest, as cards. The tree walk, the drawer and the
// only-failures filter all belong to the page and are exercised through the desktop table
// elsewhere in their own units; these cases pin the card branch, where the row's click becomes the
// whole card and the causal indent survives the loss of the table.

import { afterEach, describe, expect, it, vi } from 'vitest';

import { TracesPage } from '../../../src/components/station/traces.page';
import { stubPhoneMedia } from '../../utils/phone';
import { render, screen, setupUser, waitFor } from '../../utils/render';

const readTraces = vi.fn();
const readTrace = vi.fn();

vi.mock('../../../src/api/client', () => ({
    sdk: {
        station: {
            readTraces: (...args: unknown[]) => readTraces(...args),
            readTrace: (...args: unknown[]) => readTrace(...args),
        },
    },
}));

// A real registered job name rather than an invented one, so these cases exercise the actual
// translation table in `decision.words.ts` instead of a fixture the table has never heard of.
const decision = (over: Record<string, unknown> = {}) => ({
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    kind: 'catalog.enrich',
    at: '2026-08-25T12:00:00.000Z',
    ms: 1200,
    calls: 4,
    failed: 0,
    ...over,
});

afterEach(() => {
    vi.resetAllMocks();
});

describe('TracesPage', () => {
    it('renders each decision, on a desk, as a row of figures', async () => {
        readTraces.mockResolvedValue({ decisions: [decision()], total: 1, spans: 4 });

        render(<TracesPage />);

        expect(await screen.findByText('Asked what the providers know about a record')).toBeInTheDocument();
        expect(screen.getByRole('table')).toBeInTheDocument();
    });

    // The row used to show the wire name and nothing else, so `schedule.tick` and `GET /voices`
    // read as the same kind of fact — one a decision the station made, one a page the console asked
    // for. The sentence is what makes them different at a glance; the raw kind stays dimmed beneath
    // it for whoever is matching this row against a log line, except on a request, which already
    // reads as `GET /voices` in the sentence and would otherwise say so twice.
    it('names the decision in a sentence, and keeps the raw kind only where it says something new', async () => {
        readTraces.mockResolvedValue({
            decisions: [
                decision({ id: 'aaaaaaaa-1111-4111-8111-111111111111', kind: 'catalog.enrich' }),
                decision({ id: 'cccccccc-3333-4333-8333-333333333333', kind: 'GET /voices' }),
                decision({ id: 'dddddddd-4444-4444-8444-444444444444', kind: 'a.job.this.table.does.not.know' }),
            ],
            total: 3,
            spans: 4,
        });

        render(<TracesPage />);

        expect(await screen.findByText('Asked what the providers know about a record')).toBeInTheDocument();
        expect(screen.getByText('catalog.enrich')).toBeInTheDocument();

        expect(screen.getByText('Request · GET /voices')).toBeInTheDocument();
        expect(screen.queryByText('GET /voices', { exact: true })).not.toBeInTheDocument();

        // Unrecognised, and drawn from its own string rather than left blank.
        expect(screen.getByText('a job this table does not know')).toBeInTheDocument();
        expect(screen.getByText('a.job.this.table.does.not.know')).toBeInTheDocument();
    });

    describe('on a phone', () => {
        it('gives cards, keeping the spend, the calls and the failure count', async () => {
            const restore = stubPhoneMedia();
            try {
                readTraces.mockResolvedValue({
                    decisions: [
                        decision(),
                        decision({
                            id: 'bbbbbbbb-2222-4222-8222-222222222222',
                            kind: 'catalog.extract_facts',
                            parent: 'aaaaaaaa-1111-4111-8111-111111111111',
                            failed: 2,
                        }),
                    ],
                    total: 2,
                    spans: 8,
                });

                render(<TracesPage />);

                expect(await screen.findByText('Asked what the providers know about a record')).toBeInTheDocument();
                expect(screen.getByText('Read an article for facts to talk about')).toBeInTheDocument();
                expect(screen.getAllByText('1.2s')).toHaveLength(2);
                expect(screen.getAllByText('4 calls')).toHaveLength(2);
                expect(screen.getByText('2')).toBeInTheDocument();
                expect(screen.queryByRole('table')).not.toBeInTheDocument();
            } finally {
                restore();
            }
        });

        it('opens the drawer from a tap on the whole card', async () => {
            const restore = stubPhoneMedia();
            try {
                const user = setupUser();
                readTraces.mockResolvedValue({ decisions: [decision()], total: 1, spans: 4 });
                readTrace.mockResolvedValue({
                    decision: decision(),
                    caused: [],
                    spans: [{ at: '2026-08-25T12:00:00.000Z', op: 'plugin.call', target: 'deadair.musicbrainz', ms: 300, outcome: 'ok' }],
                });

                render(<TracesPage />);
                await screen.findByText('Asked what the providers know about a record');

                await user.click(screen.getByRole('button', { name: 'Open Asked what the providers know about a record' }));

                await waitFor(() => {
                    expect(readTrace).toHaveBeenCalledWith('aaaaaaaa-1111-4111-8111-111111111111');
                });
                expect(await screen.findByText('plugin.call')).toBeInTheDocument();
            } finally {
                restore();
            }
        });
    });
});
