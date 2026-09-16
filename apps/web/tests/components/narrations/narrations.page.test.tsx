// What a piece's state reads as on the desk. The station tells the page two different things about a
// reading in progress and they are not the same, which is the one bit of logic here worth pinning.

import { describe, expect, it } from 'vitest';
import type { StationPiece } from '@deadair/sdk';

import { pieceState } from '../../../src/components/narrations/narrations.page';

const NOW = Date.parse('2026-09-16T12:00:00.000Z');

const piece = (over: Partial<StationPiece> = {}): StationPiece =>
    ({
        id: 'piece-1',
        seriesId: 'deadair.audiobook:frankenstein',
        pieceId: 'ch4',
        seriesTitle: 'Frankenstein',
        title: 'Chapter 4',
        order: 'serial',
        seenAt: new Date(NOW).toISOString(),
        rendered: false,
        rendering: false,
        ...over,
    }) as StationPiece;

describe('pieceState', () => {
    it('reads an aired piece as read, whatever else is on the row', () => {
        // For a serial this is also the station's place in the book, so it outranks everything.
        const state = pieceState(piece({ airedAt: new Date(NOW).toISOString(), rendered: true }), NOW);

        expect(state).toEqual({ label: 'Read', tone: 'off' });
    });

    it('reads a spoken piece as ready to air', () => {
        expect(pieceState(piece({ rendered: true }), NOW)).toEqual({ label: 'Ready to air', tone: 'ok' });
    });

    it('reads a piece with a production as being read', () => {
        // The half that survives a restart: a production exists and its parts are being spoken.
        expect(pieceState(piece({ rendering: true }), NOW)).toEqual({ label: 'Reading', tone: 'standby' });
    });

    it('reads a piece asked for recently as being read, before any production exists', () => {
        // The window between the ask landing and the job opening a production.
        const asked = new Date(NOW - 60_000).toISOString();

        expect(pieceState(piece({ renderRequestedAt: asked }), NOW)).toEqual({ label: 'Reading', tone: 'standby' });
    });

    it('stops calling it read once the station would ask again', () => {
        // An hour, which is the station's own `RENDER_RETRY_AFTER_MS`: past it the page must not
        // claim something is happening that the station has given up on.
        const asked = new Date(NOW - 2 * 60 * 60_000).toISOString();

        expect(pieceState(piece({ renderRequestedAt: asked, renderError: 'no mixer' }), NOW).label).toBe('Could not read');
    });

    it('shows a failure as a fault rather than anything red', () => {
        // On this desk red is the transmitter; the station is still working.
        expect(pieceState(piece({ renderError: 'the station has no mixer' }), NOW)).toEqual({ label: 'Could not read', tone: 'fault' });
    });

    it('reads a piece nothing has happened to yet as not read', () => {
        expect(pieceState(piece(), NOW)).toEqual({ label: 'Not read yet', tone: 'off' });
    });
});
