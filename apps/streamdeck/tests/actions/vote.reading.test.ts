import { describe, expect, it } from 'vitest';

import { voteView } from '../../src/actions/vote.reading.js';
import type { Reading } from '../../src/station/status.poller.js';
import { airing, record, stoodDown } from '../fixtures/playout.status.js';

const on: Reading = { status: airing(), readAt: 1_000, stale: false };

describe('voteView', () => {
    it('lights the key the station already agrees with, and leaves the other dark', () => {
        expect(voteView(on, { rating: 'liked' }, 'liked').lit).toBe(true);
        expect(voteView(on, { rating: 'liked' }, 'disliked').lit).toBe(false);
    });

    it('writes its own opinion from a dark key and withdraws it from a lit one', () => {
        expect(voteView(on, { rating: 'neutral' }, 'liked').press).toEqual({ trackId: record.trackId, rating: 'liked' });
        expect(voteView(on, { rating: 'liked' }, 'liked').press).toEqual({ trackId: record.trackId, rating: 'neutral' });
        expect(voteView(on, { rating: 'liked' }, 'disliked').press).toEqual({ trackId: record.trackId, rating: 'disliked' });
    });

    it('writes its own opinion while the record’s rating is not known yet, so a first press is never a withdrawal', () => {
        expect(voteView(on, undefined, 'liked')).toEqual({ lit: false, dim: false, title: '', press: { trackId: record.trackId, rating: 'liked' } });
        expect(voteView(on, { rating: undefined }, 'disliked').press).toEqual({ trackId: record.trackId, rating: 'disliked' });
    });

    it('refuses a press on something with no row in the catalog to hold an opinion', () => {
        const { trackId: _trackId, ...aBreak } = record;
        const status = airing({ nowPlaying: { item: aBreak, startedAt: 1_000 } });
        expect(voteView({ status, readAt: 1_000, stale: false }, undefined, 'liked')).toEqual({ lit: false, dim: true, title: '' });
    });

    it('refuses a press with nothing on air', () => {
        expect(voteView({ status: stoodDown(), readAt: 1_000, stale: false }, { rating: 'liked' }, 'liked')).toEqual({
            lit: false,
            dim: true,
            title: '',
        });
    });

    it('goes faint on a stale reading, whatever it knew: the opinion may be about the record before this one', () => {
        const stale: Reading = { status: airing(), readAt: 1_000, failure: 'unreachable', stale: true };
        expect(voteView(stale, { rating: 'liked' }, 'liked')).toEqual({ lit: false, dim: true, title: 'No station' });
    });

    it('says why there is no station to vote at', () => {
        expect(voteView({ failure: 'unconfigured', stale: false }, undefined, 'liked')).toEqual({ lit: false, dim: true, title: 'Set up' });
    });
});
