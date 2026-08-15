// The half of this plugin that can be wrong without failing. A resolve that picks the wrong article
// does not throw: it produces a station saying something true about a different record, in the same
// confident voice. So the acceptance rules are asserted rather than assumed.

import { describe, expect, it } from 'vitest';

import {
    articleUrl,
    asDocument,
    chooseSong,
    claimedIds,
    extractOf,
    labelOf,
    MIN_ARTICLE_CHARS,
    searchedIds,
    siteKey,
    sitelinkTitle,
    songCandidate,
    songSearchTerms,
    statementQuery,
    type SongCandidate,
} from '../src/wikipedia.resolve.js';
import type { WikidataEntity } from '../src/wikipedia.types.js';

const RETRIEVED = '2026-08-15T09:00:00.000Z';

describe('addressing Wikidata', () => {
    it('asks for a statement rather than for words', () => {
        expect(statementQuery('P434', '153c9281-268f-4cf3-8938-f5a4593e5df4')).toBe('haswbstatement:P434=153c9281-268f-4cf3-8938-f5a4593e5df4');
    });

    it('names the sitelink for a language, including a dashed one', () => {
        expect(siteKey('en')).toBe('enwiki');
        expect(siteKey('pt-br')).toBe('pt_brwiki');
    });

    it('keeps only the Q-ids out of a search, in the order they were ranked', () => {
        const response = { query: { search: [{ title: 'Q2744292' }, { title: 'Help:Contents' }, { title: 'Q136098430' }] } };

        expect(searchedIds(response)).toEqual(['Q2744292', 'Q136098430']);
    });

    it('has nothing to say about a search that found nothing', () => {
        expect(searchedIds({ query: { search: [] } })).toEqual([]);
        expect(searchedIds({})).toEqual([]);
    });
});

describe('reading an entity', () => {
    const entity: WikidataEntity = {
        id: 'Q2744292',
        labels: { en: { value: 'Rusty Cage' }, de: { value: 'Rusty Cage (Lied)' } },
        sitelinks: { enwiki: { site: 'enwiki', title: 'Rusty Cage' } },
        claims: {
            P175: [
                { mainsnak: { snaktype: 'value', datavalue: { value: { id: 'Q174817' } } } },
                { mainsnak: { snaktype: 'somevalue' } },
                { mainsnak: { snaktype: 'value', datavalue: { value: {} } } },
            ],
        },
    };

    it('prefers the wanted language, then English, then whatever there is', () => {
        expect(labelOf(entity, 'de')).toBe('Rusty Cage (Lied)');
        expect(labelOf(entity, 'fr')).toBe('Rusty Cage');
        expect(labelOf({ labels: { pl: { value: 'Klatka' } } }, 'fr')).toBe('Klatka');
        expect(labelOf({}, 'en')).toBeUndefined();
    });

    it('finds the article for the wanted edition and no other', () => {
        expect(sitelinkTitle(entity, 'en')).toBe('Rusty Cage');
        expect(sitelinkTitle(entity, 'de')).toBeUndefined();
    });

    it('reads only the claims that actually point at something', () => {
        // `somevalue` means "there is one and we do not know it", which is not an id.
        expect(claimedIds(entity, 'P175')).toEqual(['Q174817']);
        expect(claimedIds(entity, 'P999')).toEqual([]);
    });
});

describe('an article extract', () => {
    it('reads the prose off the page that exists', () => {
        const response = {
            query: {
                pages: [
                    { title: 'Nope', missing: true },
                    { pageid: 1, title: 'Rusty Cage', extract: 'A song by Soundgarden.' },
                ],
            },
        };

        expect(extractOf(response)).toEqual({ title: 'Rusty Cage', text: 'A song by Soundgarden.' });
    });

    it('reads a page that does not exist as nothing, rather than as a failure', () => {
        // A record with no article is the ordinary case on any real catalog.
        expect(extractOf({ query: { pages: [{ title: 'Nope', missing: true }] } })).toBeUndefined();
        expect(extractOf({})).toBeUndefined();
    });

    it('builds the citation from the title, since the API answers with one and a reader wants an address', () => {
        expect(articleUrl('en', 'Rusty Cage')).toBe('https://en.wikipedia.org/wiki/Rusty_Cage');
        expect(articleUrl('en', 'Portishead (band)')).toBe('https://en.wikipedia.org/wiki/Portishead_(band)');
    });

    it('refuses a stub, which costs a row and says only what the catalog already knows', () => {
        expect(asDocument('en', { title: 'Obscurity', text: 'Obscurity is a song.' }, RETRIEVED)).toBeUndefined();
    });

    it('hands over a real article whole, with the timestamp as the string it was given', () => {
        const text = 'x'.repeat(MIN_ARTICLE_CHARS);

        expect(asDocument('en', { title: 'Rusty Cage', text }, RETRIEVED)).toEqual({
            url: 'https://en.wikipedia.org/wiki/Rusty_Cage',
            title: 'Rusty Cage',
            text,
            retrievedAt: RETRIEVED,
        });
    });
});

describe('searching for a song by name', () => {
    it('drops the decorations a pressing added, which are not words in an article', () => {
        expect(songSearchTerms('Rusty Cage - Remastered 2016', 'Soundgarden')).toBe('Rusty Cage Soundgarden');
        expect(songSearchTerms('Walk This Way (feat. Aerosmith)', 'Run–D.M.C.')).toBe('Walk This Way Run–D.M.C.');
    });

    it('keeps the punctuation otherwise, because a search engine does its own folding', () => {
        expect(songSearchTerms('Mr. Brightside', 'The Killers')).toBe('Mr. Brightside The Killers');
    });

    it('asks nothing when there is nothing to ask about', () => {
        expect(songSearchTerms('', 'Soundgarden')).toBeUndefined();
        expect(songSearchTerms('(Live)', 'Soundgarden')).toBeUndefined();
        expect(songSearchTerms('Rusty Cage', '   ')).toBeUndefined();
    });
});

describe('choosing which found item is really the song', () => {
    const song: SongCandidate = { id: 'Q2744292', label: 'Rusty Cage', article: 'Rusty Cage', performerIds: ['Q174817'] };
    const performers = new Map([
        ['Q174817', 'Soundgarden'],
        ['Q42', 'Johnny Cash'],
    ]);

    it('takes the item whose label is the title and whose performer is the artist', () => {
        expect(chooseSong([song], performers, 'Rusty Cage', 'Soundgarden')?.id).toBe('Q2744292');
    });

    it('matches through the decorations the catalog carries on both sides', () => {
        expect(chooseSong([song], performers, 'Rusty Cage - Remastered 2016', 'Soundgarden')?.id).toBe('Q2744292');
    });

    it('refuses an item with the right name by the wrong artist', () => {
        // The cover exists, is called the same thing, and is a different record.
        const cover = { ...song, id: 'Q9', performerIds: ['Q42'] };

        expect(chooseSong([cover], performers, 'Rusty Cage', 'Soundgarden')).toBeUndefined();
    });

    it('refuses the right artist under a different title, which is how an album beats its title track', () => {
        const album = { ...song, id: 'Q8', label: 'Badmotorfinger' };

        expect(chooseSong([album], performers, 'Rusty Cage', 'Soundgarden')).toBeUndefined();
    });

    it('refuses an item with no article, however well it matches', () => {
        // This is the recording item: correct in every respect and nothing to read.
        const recording = { ...song, id: 'Q136098430', article: undefined };

        expect(chooseSong([recording], performers, 'Rusty Cage', 'Soundgarden')).toBeUndefined();
    });

    it('refuses a performer it could not read a label for, rather than assuming', () => {
        expect(chooseSong([song], new Map(), 'Rusty Cage', 'Soundgarden')).toBeUndefined();
    });

    it('takes the first acceptable candidate in search order', () => {
        const second = { ...song, id: 'Q7' };

        expect(chooseSong([{ ...song, label: 'Something Else' }, second], performers, 'Rusty Cage', 'Soundgarden')?.id).toBe('Q7');
    });

    it('asks nothing of an empty title or artist', () => {
        expect(chooseSong([song], performers, '', 'Soundgarden')).toBeUndefined();
        expect(chooseSong([song], performers, 'Rusty Cage', '')).toBeUndefined();
    });
});

describe('flattening a candidate', () => {
    it('reads the label, the article and the performers off one entity', () => {
        const entity: WikidataEntity = {
            labels: { en: { value: 'Rusty Cage' } },
            sitelinks: { enwiki: { title: 'Rusty Cage' } },
            claims: { P175: [{ mainsnak: { snaktype: 'value', datavalue: { value: { id: 'Q174817' } } } }] },
        };

        expect(songCandidate('Q2744292', entity, 'en')).toEqual({
            id: 'Q2744292',
            label: 'Rusty Cage',
            article: 'Rusty Cage',
            performerIds: ['Q174817'],
        });
    });

    it('survives an entity the API did not return at all', () => {
        expect(songCandidate('Q1', undefined, 'en')).toEqual({ id: 'Q1', label: undefined, article: undefined, performerIds: [] });
    });
});
