// The panel shows claims made by an upstream, so the parts that say *whose* claim it is and *how
// old* carry as much weight as the facts themselves.

import { describe, expect, it, vi } from 'vitest';
import { SdkError } from '@deadair/sdk';

import { EnrichmentPanel, type EnrichmentClaim, type EnrichmentProvenance } from '../../../src/components/catalog/enrichment.panel';
import { render, screen } from '../../utils/render';

vi.mock('../../../src/api/client', () => ({ BASE_URL: '/api' }));

const source = (overrides: Partial<EnrichmentProvenance> = {}): EnrichmentProvenance => ({
    provider: 'deadair.musicbrainz',
    fetchedAt: '2026-08-02T09:00:00.000Z',
    expiresAt: '2026-10-31T09:00:00.000Z',
    stale: false,
    found: true,
    failed: false,
    ...overrides,
});

const panel = (props: Partial<Parameters<typeof EnrichmentPanel>[0]> = {}) => (
    <EnrichmentPanel isPending={false} error={undefined} emptyMessage="No provider has been asked about this track yet." {...props} />
);

describe('EnrichmentPanel', () => {
    it('shows the facts, tags and links a provider resolved', () => {
        render(
            panel({
                merged: {
                    genres: ['trip hop'],
                    moods: ['nocturnal'],
                    label: 'Go! Beat',
                    bpm: 92,
                    musicalKey: 'A minor',
                    facts: ['Recorded at State of Art in Bristol.'],
                    links: [{ label: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Dummy_(album)' }],
                },
                sources: [source()],
            }),
        );

        expect(screen.getByText('trip hop')).toBeInTheDocument();
        expect(screen.getByText('nocturnal')).toBeInTheDocument();
        expect(screen.getByText('Go! Beat')).toBeInTheDocument();
        expect(screen.getByText('A minor')).toBeInTheDocument();
        expect(screen.getByText('Recorded at State of Art in Bristol.')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Wikipedia' })).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Dummy_(album)');
    });

    // These point at whatever an upstream said, not at us.
    it('opens a link out in a new tab without handing over the referrer', () => {
        render(panel({ merged: { links: [{ label: 'Discogs', url: 'https://www.discogs.com/master/1' }] }, sources: [source()] }));

        const link = screen.getByRole('link', { name: 'Discogs' });
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noreferrer');
    });

    it('names the provider and when it answered', () => {
        render(panel({ merged: { label: 'Go! Beat' }, sources: [source()] }));

        // The date is formatted in the reader's own locale, so the assertion is on the year rather
        // than on one locale's spelling of the day.
        expect(screen.getByText(/deadair\.musicbrainz/)).toHaveTextContent(/2026/);
    });

    // Silence from a source and never having asked it are different states, and only one of them
    // is worth waiting out.
    it('reports a provider that was asked and had nothing, rather than hiding it', () => {
        render(panel({ merged: {}, sources: [source({ found: false })] }));

        expect(screen.getByText(/nothing found/)).toBeInTheDocument();
    });

    // Both arrive as an empty payload and they are opposite facts: one is settled, the other is the
    // walk still owing this record an answer. Reading them as one another is what "nothing found"
    // did for as long as it covered both.
    it('says a provider could not be asked, rather than that it had nothing', () => {
        render(panel({ merged: {}, sources: [source({ found: false, failed: true })] }));

        expect(screen.getByText(/could not ask/)).toBeInTheDocument();
        expect(screen.queryByText(/nothing found/)).not.toBeInTheDocument();
    });

    it('keeps showing what a now-failing source said before it broke', () => {
        render(panel({ merged: { label: 'Go! Beat' }, sources: [source({ failed: true })] }));

        expect(screen.getByText(/deadair\.musicbrainz/)).toHaveTextContent(/2026/);
        expect(screen.getByText(/could not re-ask/)).toBeInTheDocument();
    });

    it('marks a payload that is past its TTL as due again', () => {
        render(panel({ merged: { label: 'Go! Beat' }, sources: [source({ stale: true })] }));

        expect(screen.getByText(/due again/)).toBeInTheDocument();
    });

    it('says the walk has not reached this row rather than implying there is nothing to know', () => {
        render(panel({ merged: {}, sources: [] }));

        expect(screen.getByText('No provider has been asked about this track yet.')).toBeInTheDocument();
    });

    it('surfaces a failed read as an alert', () => {
        render(panel({ error: new SdkError(503, 'Service Unavailable', { statusCode: 503, message: 'no' }, new Headers()) }));

        expect(screen.getByText('The enrichment could not be loaded')).toBeInTheDocument();
    });

    // `extra` is by definition unknown-shaped, so it is offered as what it is rather than rendered
    // as though the console knew what the keys meant.
    it('offers the fields the SDK has no name for behind a count', () => {
        render(panel({ merged: { extra: { listeners: 412_000 } }, sources: [source()] }));

        expect(screen.getByText('Show 1 unmapped field')).toBeInTheDocument();
    });

    describe('the claims the station extracted', () => {
        const claim = (overrides: Partial<EnrichmentClaim> = {}): EnrichmentClaim => ({
            id: 'fact-1',
            claim: 'It was used in Ace Ventura.',
            category: 'placement',
            source: 'model',
            sourceUrl: 'https://en.wikipedia.org/wiki/Rusty_Cage',
            sourceQuote: 'The song appeared in the 1994 film Ace Ventura: Pet Detective.',
            ...overrides,
        });

        it('shows the sentence, and the words it was read out of', () => {
            // The quote is the whole reason this section exists. Everything else on the card is
            // structured data, where being wrong looks like a missing genre; this is a sentence the
            // DJ will say out loud, and the only check available is reading the source.
            render(panel({ claims: [claim()], sources: [source()] }));

            expect(screen.getByText('It was used in Ace Ventura.')).toBeInTheDocument();
            expect(screen.getByText(/The song appeared in the 1994 film/)).toBeInTheDocument();
        });

        it('links out to where a person can check it', () => {
            render(panel({ claims: [claim()], sources: [source()] }));

            const citation = screen.getByRole('link', { name: 'https://en.wikipedia.org/wiki/Rusty_Cage' });
            expect(citation).toHaveAttribute('href', 'https://en.wikipedia.org/wiki/Rusty_Cage');
            expect(citation).toHaveAttribute('rel', 'noreferrer');
        });

        it('says what kind of fact it is, spelled for a reader rather than for a column', () => {
            render(panel({ claims: [claim({ category: 'cover_or_sample' })], sources: [source()] }));

            expect(screen.getByText('cover or sample')).toBeInTheDocument();
        });

        it('shows them for a record no provider has answered about, since the claims are the host’s own', () => {
            // A source could be uninstalled, or the walk could have stored prose and nothing else.
            // Either way what the station believes is still worth showing.
            render(panel({ claims: [claim()], sources: [] }));

            expect(screen.getByText('It was used in Ace Ventura.')).toBeInTheDocument();
            expect(screen.queryByText('No provider has been asked about this track yet.')).not.toBeInTheDocument();
        });
    });
});
