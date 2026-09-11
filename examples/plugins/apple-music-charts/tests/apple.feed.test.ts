import { describe, expect, it } from 'vitest';

import { artistSlugOf, parseFeed, slugOf, splitCredit } from '../src/apple.feed.js';

const url = (slug: string): string => `https://music.apple.com/gb/artist/${slug}/978839124`;

describe('splitCredit', () => {
    it('keeps a solo credit whole', () => {
        expect(splitCredit('Olivia Dean', url('olivia-dean'))).toEqual({ artist: 'Olivia Dean', featuring: [] });
    });

    it('takes the lead from the artist page and features everybody after it', () => {
        expect(splitCredit('HUGEL, Imael Angel & Ultra Naté', url('hugel'))).toEqual({
            artist: 'HUGEL',
            featuring: ['Imael Angel', 'Ultra Naté'],
        });
        expect(splitCredit('Sam Fender & Olivia Dean', url('sam-fender'))).toEqual({ artist: 'Sam Fender', featuring: ['Olivia Dean'] });
    });

    it('does not break a name that has a comma or an ampersand in it', () => {
        expect(splitCredit('Tyler, The Creator & Kali Uchis', url('tyler-the-creator'))).toEqual({
            artist: 'Tyler, The Creator',
            featuring: ['Kali Uchis'],
        });
        expect(splitCredit('Simon & Garfunkel', url('simon-garfunkel'))).toEqual({ artist: 'Simon & Garfunkel', featuring: [] });
    });

    it('reads feat., ft., featuring and x as joiners', () => {
        expect(splitCredit('Calvin Harris feat. Dua Lipa', url('calvin-harris'))).toEqual({ artist: 'Calvin Harris', featuring: ['Dua Lipa'] });
        expect(splitCredit('A ft. B featuring C x D', url('a'))).toEqual({ artist: 'A', featuring: ['B', 'C', 'D'] });
    });

    it('keeps the whole credit when the artist page names nobody in it', () => {
        expect(splitCredit('Shakira & Burna Boy', url('somebody-else'))).toEqual({ artist: 'Shakira & Burna Boy', featuring: [] });
        expect(splitCredit('Shakira & Burna Boy', undefined)).toEqual({ artist: 'Shakira & Burna Boy', featuring: [] });
    });
});

describe('slugOf and artistSlugOf', () => {
    it('writes a name the way Apple writes it into a URL', () => {
        expect(slugOf('Ultra Naté')).toBe('ultra-nate');
        expect(slugOf('AC/DC')).toBe('ac-dc');
        expect(slugOf('Tyler, The Creator')).toBe('tyler-the-creator');
    });

    it('reads the slug off an artist page and nothing else', () => {
        expect(artistSlugOf('https://music.apple.com/gb/artist/sam-fender/1213989970')).toBe('sam-fender');
        expect(artistSlugOf('https://music.apple.com/gb/album/rein-me-in/1820918466')).toBeUndefined();
        expect(artistSlugOf(undefined)).toBeUndefined();
    });
});

describe('parseFeed', () => {
    it('answers the entries in chart order', () => {
        const entries = parseFeed({
            feed: {
                results: [
                    { name: 'One', artistName: 'A' },
                    { name: 'Two', artistName: 'B' },
                ],
            },
        });
        expect(entries.map(entry => entry.name)).toEqual(['One', 'Two']);
    });

    it('refuses a document that is not a chart', () => {
        expect(() => parseFeed({ results: [] })).toThrow();
    });
});
