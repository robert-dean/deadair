// The list is one composition and the whole of it is which facts reach it and in what order. Two
// rules are worth pinning above all: a `waiting` gate is the station idling on purpose and must not
// appear at all, and the sentence for a silence is the diagnosis's own — a second wording here would
// be a second thing to disagree with the badge, the strip and the activity feed.

import { describe, expect, it } from 'vitest';

import type { FaultingCopy, FaultingTrack } from '../../../src/modules/catalog/tracks.repository.js';
import { attention, type AttentionFacts, type QuotedSilence } from '../../../src/modules/station/station.attention.js';

const airing: QuotedSilence = {
    audible: true,
    cause: 'airing',
    detail: 'The station is holding the mount and its programme is going out.',
    checks: [{ code: 'configNotAdopted', state: 'ok', detail: 'Both stream containers are running the current config.' }],
};

/** A station with nothing wrong with it, which is the case every test below varies one fact of. */
function facts(overrides: Partial<AttentionFacts> = {}): AttentionFacts {
    return {
        silence: airing,
        benched: 0,
        failing: 0,
        benchedExamples: [],
        failingExamples: [],
        tracks: 900,
        unavailableItems: 0,
        brokenPlugins: [],
        ...overrides,
    };
}

/** One copy, as the catalog hands it over: a healthy one, varied a column at a time below. */
function copy(overrides: Partial<FaultingCopy> = {}): FaultingCopy {
    return { pluginId: 'deadair.spotify', playable: true, benched: false, attempts: 0, ...overrides };
}

function faulting(overrides: Partial<FaultingTrack> = {}): FaultingTrack {
    return { trackId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', title: 'Push It', artists: 'Salt-N-Pepa', copies: [copy()], ...overrides };
}

describe('attention', () => {
    it('answers with nothing for a station that is working', () => {
        // An explicit empty list rather than a placeholder item. "Nothing needs you" is a real
        // answer and the console draws it as one.
        expect(attention(facts())).toEqual([]);
    });

    it('quotes the silence rather than composing a second sentence for it', () => {
        const silence: QuotedSilence = {
            audible: false,
            cause: 'streamUnreachable',
            detail: "Liquidsoap's control API is not answering, so nothing can go to air whatever the running order holds.",
            remedy: 'Check that the liquidsoap container is running and reachable at its control address.',
            checks: [{ code: 'streamUnreachable', state: 'fault', detail: 'unused' }],
        };

        const [item] = attention(facts({ silence }));

        expect(item).toMatchObject({ code: 'streamUnreachable', severity: 'failure', route: '/onair' });
        expect(item?.detail).toBe(`${silence.detail} ${silence.remedy}`);
    });

    it('says nothing about a station that is silent on purpose', () => {
        // The whole reason the diagnosis has three states rather than two. An empty room, a station
        // stood down and a record still downloading are all silences with nothing to do about them,
        // and a list that reported them would be one an operator learns to skim.
        const waiting: QuotedSilence = {
            audible: false,
            cause: 'noAudience',
            detail: 'The station is loaded and the stream is up. It goes on air the moment somebody starts listening.',
            checks: [{ code: 'noAudience', state: 'waiting', detail: 'unused' }],
        };

        expect(attention(facts({ silence: waiting }))).toEqual([]);
    });

    it('reports replaced config as its own warning rather than as the silence', () => {
        // It is a fault that is never the cause: a station airs perfectly well to somebody who
        // connected before the config was replaced. Folding it into the silence above would make it
        // the reason for a quiet that has a different reason, which is how a real warning stops
        // being believed.
        const silence: QuotedSilence = {
            audible: true,
            cause: 'airing',
            detail: 'unused',
            checks: [
                {
                    code: 'configNotAdopted',
                    state: 'fault',
                    detail: 'icecast is running config the app has replaced.',
                    remedy: 'docker restart icecast',
                },
            ],
        };

        expect(attention(facts({ silence }))).toEqual([
            {
                code: 'configNotAdopted',
                severity: 'warning',
                title: 'A stream container is running replaced config',
                detail: 'icecast is running config the app has replaced. Restart it with: docker restart icecast',
                route: '/settings',
            },
        ]);
    });

    it('puts the failure first and keeps the build order inside a severity', () => {
        // Worst first, and then the station outward: what is on air, then what feeds it, then the
        // library behind that. The sort is stable so the second half of that survives.
        const silence: QuotedSilence = {
            audible: false,
            cause: 'noProgramme',
            detail: 'nothing left to air',
            checks: [{ code: 'noProgramme', state: 'fault', detail: 'unused' }],
        };

        const codes = attention(
            facts({
                silence,
                benched: 4,
                unavailableItems: 2,
                brokenPlugins: [{ id: 'deadair.spotify', name: 'Spotify', status: 'failed' }],
            }),
        ).map(item => item.code);

        expect(codes).toEqual(['noProgramme', 'unavailableItems', 'plugin.failed', 'benchedCopies']);
    });

    // The reason this item exists at all. A fetcher with no login of its own produces benched copies,
    // failing fetches and records dropped from the running order, and every one of those points at
    // the catalog page, where the records are individually fine and nothing explains anything.
    it('puts an unauthorized fetcher above the symptoms it causes', () => {
        const codes = attention(
            facts({
                unauthorizedFetcher: { pluginId: 'deadair.spotify', pluginName: 'Spotify' },
                benched: 16,
                failing: 31,
                unavailableItems: 16,
            }),
        ).map(item => item.code);

        expect(codes).toEqual(['fetcherNotAuthorized', 'unavailableItems', 'benchedCopies', 'failingFetches']);
    });

    it('routes an unauthorized fetcher at the plugin page that can fix it', () => {
        const [item] = attention(facts({ unauthorizedFetcher: { pluginId: 'deadair.spotify', pluginName: 'Spotify' } }));

        expect(item).toMatchObject({ code: 'fetcherNotAuthorized', severity: 'failure', route: '/plugins/deadair.spotify' });
        // It has to say which credential this is, because the operator has already connected one.
        expect(item?.detail).toContain('separate one-time authorization');
    });

    it('says nothing about a fetcher on a station that has no fact about one', () => {
        // Undefined covers an authorized fetcher, a fetcher that did not answer, and a station whose
        // records come from somewhere that has none. None of the three is something to go and do.
        expect(attention(facts()).map(item => item.code)).toEqual([]);
    });

    it('names the plugin rather than counting them', () => {
        // A station runs a handful, and which one it is IS the whole of what an operator needs. The
        // route goes to that plugin's own page, not to the list.
        const [item] = attention(facts({ brokenPlugins: [{ id: 'deadair.kokoro', name: 'Kokoro', status: 'misconfigured' }] }));

        expect(item).toMatchObject({ title: 'Kokoro is not running', route: '/plugins/deadair.kokoro', severity: 'warning' });
    });

    it('reports an empty catalog as a notice and stops there', () => {
        // A fresh install is not a broken station, and there is nothing to say about benched copies
        // in a library that has no records in it.
        const items = attention(facts({ tracks: 0, benched: 3, failing: 2 }));

        expect(items).toHaveLength(1);
        expect(items[0]).toMatchObject({ code: 'emptyCatalog', severity: 'notice' });
    });

    it('counts benched and failing separately', () => {
        // Two different problems: benched is every copy written off, failing is a fetch backing off
        // and still being retried. Collapsing them would put a record that will probably play next
        // hour in the same line as one that cannot play at all.
        const items = attention(facts({ benched: 4, failing: 11 }));

        expect(items.map(item => [item.code, item.count])).toEqual([
            ['benchedCopies', 4],
            ['failingFetches', 11],
        ]);
    });

    it('sends the state as well as the page, so the row lands on the records it counted', () => {
        // The whole complaint the state carries is here: a row about four records that lands on a
        // library of eight hundred has told an operator to go and find them.
        const items = attention(facts({ benched: 4, failing: 11 }));

        expect(items.map(item => item.route)).toEqual(['/catalog?state=benched', '/catalog?state=failing']);
    });

    it('tells a copy the provider refused from one the station benched itself', () => {
        // The two wear the same word on the catalog page and are opposite instructions. Nothing
        // clears `playable`, so telling an operator to wait for a sync is advice that cannot work —
        // which is what the row's own sentence used to promise for both.
        const refused = attention(facts({ benched: 1, benchedExamples: [faulting({ copies: [copy({ playable: false })] })] }))[0]?.evidence?.[0];

        expect(refused?.reason).toContain('will never serve this copy');
        expect(refused?.reason).toContain('needs another source');
        expect(refused?.reason).not.toContain('sync');

        const benched = attention(
            facts({ benched: 1, benchedExamples: [faulting({ copies: [copy({ benched: true, attempts: 4, lastError: 'HTTP 404' })] })] }),
        )[0]?.evidence?.[0];

        expect(benched?.reason).toBe('Written off after 4 failed fetches. The next sync that still lists the copy puts it back. HTTP 404');
    });

    it('carries the recorded error rather than a paraphrase of it', () => {
        // "HTTP 404 from the audio url" and "ECONNREFUSED" are two different mornings, and this is
        // the whole reason the evidence is worth carrying at all.
        const [piece] =
            attention(
                facts({
                    failing: 1,
                    failingExamples: [
                        faulting({ title: 'Fuel', artists: 'Metallica', copies: [copy({ attempts: 2, lastError: 'HTTP 404 from the audio url' })] }),
                    ],
                }),
            )[0]?.evidence ?? [];

        expect(piece).toEqual({
            label: 'Fuel — Metallica',
            reason: '2 consecutive failures, backing off; four in a row writes the copy off. HTTP 404 from the audio url',
            route: '/catalog/tracks/ffffffff-ffff-4fff-8fff-ffffffffffff',
        });
    });

    it('speaks for the copy that has tried hardest, and says nothing where nothing was recorded', () => {
        // A record with several copies has several stories and one of them is the answer. A copy
        // nothing has ever tried has no error, and a sentence ending in a stray "undefined" is worse
        // than one that stops.
        const [piece] =
            attention(
                facts({
                    failing: 1,
                    failingExamples: [faulting({ copies: [copy({ attempts: 1, lastError: 'a blip' }), copy({ pluginId: 'deadair.navidrome' })] })],
                }),
            )[0]?.evidence ?? [];

        expect(piece?.reason).toBe('1 consecutive failure, backing off; four in a row writes the copy off. a blip');

        const quiet = attention(facts({ failing: 1, failingExamples: [faulting()] }))[0]?.evidence?.[0];

        expect(quiet?.reason).toBe('Backing off; four in a row writes the copy off.');
    });

    it('keeps the count true when it is showing fewer than it counted', () => {
        // The console draws "… and N more" off exactly this difference, so a row that quietly
        // reported its sample as the whole set would be the shorter list reading as the answer.
        const [item] = attention(facts({ benched: 40, benchedExamples: [faulting(), faulting({ title: 'Whatta Man' })] }));

        expect(item?.count).toBe(40);
        expect(item?.evidence).toHaveLength(2);
    });

    it('says one record rather than 1 records', () => {
        expect(attention(facts({ benched: 1 }))[0]?.title).toBe('1 record has no copy left that will play');
    });
});
