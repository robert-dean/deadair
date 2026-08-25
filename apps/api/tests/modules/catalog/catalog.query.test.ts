// `likeContains` is the only place a user's raw string becomes SQL syntax. The escaping is not
// about injection — the value is still a bound parameter — but about a search for "50%" matching
// every row in the catalog because `%` is a wildcard on the other side of the parameter.

import { describe, expect, it } from 'vitest';

import { columnFor, likeContains } from '../../../src/modules/catalog/catalog.query.js';

describe('likeContains', () => {
    it('wraps an ordinary term so it matches anywhere in the value', () => {
        expect(likeContains('sigur')).toBe('%sigur%');
    });

    it('escapes the wildcards, so a term containing one matches it literally', () => {
        expect(likeContains('50%')).toBe('%50\\%%');
        expect(likeContains('chapter_1')).toBe('%chapter\\_1%');
    });

    it('escapes the escape character itself, so a backslash cannot smuggle one in', () => {
        expect(likeContains('AC\\DC')).toBe('%AC\\\\DC%');
        // The already-doubled form stays doubled rather than collapsing back to one escape.
        expect(likeContains('\\%')).toBe('%\\\\\\%%');
    });

    it('leaves a term with no letters alone rather than treating it as empty', () => {
        expect(likeContains('!!!')).toBe('%!!!%');
    });
});

// The three lists share one sort vocabulary and none of them can answer all of it, so what matters
// here is the fall-back: an ordering a list cannot serve has to open in its ordinary order rather
// than fail. The SQL these column names go into is covered by `scripts/catalog.sort.smoke.ts`,
// against the real database, on the rule the rating and era expressions already follow.
describe('columnFor', () => {
    const ARTIST_SORTS = { name: 'artists.name', albums: 'albumCount', tracks: 'trackCount' } as const;

    it('answers the column a key names', () => {
        expect(columnFor('albums', ARTIST_SORTS, ARTIST_SORTS.name)).toBe('albumCount');
    });

    it('falls back when nothing was asked for, which is every list at rest', () => {
        expect(columnFor(undefined, ARTIST_SORTS, ARTIST_SORTS.name)).toBe('artists.name');
    });

    /**
     * The case the fall-back exists for: one enum covers artists and albums, so an operator moving
     * between the two lists carries a key the second one has no column for. That is an ordinary
     * list in its ordinary order, not an error.
     */
    it('falls back on a key this list has no column for', () => {
        expect(columnFor('year', ARTIST_SORTS, ARTIST_SORTS.name)).toBe('artists.name');
    });

    /** A value off the wire that the enum should have refused, arriving anyway. */
    it('falls back on a word the vocabulary does not contain at all', () => {
        expect(columnFor('lastPlayed', ARTIST_SORTS, ARTIST_SORTS.name)).toBe('artists.name');
    });

    /**
     * `Record` lookups reach the prototype, and `constructor` is a key every object answers. Without
     * the map being consulted as data this would put a function where a column name goes.
     */
    it('falls back on an inherited property name rather than answering with one', () => {
        expect(columnFor('constructor', ARTIST_SORTS, ARTIST_SORTS.name)).toBe('artists.name');
        expect(columnFor('toString', ARTIST_SORTS, ARTIST_SORTS.name)).toBe('artists.name');
    });
});
