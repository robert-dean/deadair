// `likeContains` is the only place a user's raw string becomes SQL syntax. The escaping is not
// about injection — the value is still a bound parameter — but about a search for "50%" matching
// every row in the catalog because `%` is a wildcard on the other side of the parameter.

import { describe, expect, it } from 'vitest';

import { likeContains } from '../../../src/modules/catalog/catalog.query.js';

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
