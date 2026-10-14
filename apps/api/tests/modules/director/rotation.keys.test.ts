// The spacing rules compare a joined lead credit ("Yusuf / Cat Stevens") with the acts inside it.
// The guard rails are the point: a rule that reads "Air" inside "Air Supply" holds a station's
// records against strangers, and nothing on air says why.

import { describe, expect, it } from 'vitest';

import {
    actsInJoinedCredits,
    artistActs,
    artistCreditsOverlap,
    artistKey,
    creditKey,
    isArtistHeld,
    knownActsOf,
    sameAct,
    spacingKeys,
    withKnownActs,
} from '../../../src/modules/director/rotation.keys.js';

describe('artistActs', () => {
    it('splits where a joining mark stands with a space beside it', () => {
        expect(artistActs('Yusuf / Cat Stevens')).toEqual(['yusuf', 'cat stevens']);
        expect(artistActs('Pixies • Black Francis')).toEqual(['pixies', 'black francis']);
        expect(artistActs('Sly & Robbie')).toEqual(['sly', 'robbie']);
        expect(artistActs('M / Robin Scott')).toEqual(['m', 'robin scott']);
        expect(artistActs('USHER, Lil Jon, Ludacris')).toEqual(['usher', 'lil jon', 'ludacris']);
    });

    it('keeps a name whole where the mark has no space, or the space no mark', () => {
        expect(artistActs('Jay-Z')).toEqual(['jay z']);
        expect(artistActs('AC/DC')).toEqual(['ac dc']);
        expect(artistActs('Air Supply')).toEqual(['air supply']);
    });

    it('never splits on a full stop, a quote or a bracket', () => {
        expect(artistActs('Mr. Big')).toEqual(['mr big']);
        expect(artistActs("Guns N' Roses")).toEqual(['guns n roses']);
        expect(artistActs('Nirvana (UK)')).toEqual(['nirvana uk']);
    });

    it('answers nothing for a credit with no letters or digits', () => {
        expect(artistActs('')).toEqual([]);
        expect(artistActs(' / ')).toEqual([]);
    });
});

describe('creditKey', () => {
    it('is the artist key itself for a credit naming one act', () => {
        for (const name of ['Cat Stevens', 'Jay-Z', 'Beyoncé', 'AC/DC']) expect(creditKey(name)).toBe(artistKey([name]));
    });

    it('keeps the joins of a joined credit, and answers itself when fed back in', () => {
        expect(creditKey('Yusuf / Cat Stevens')).toBe('yusuf / cat stevens');
        expect(creditKey(creditKey('Pixies • Black Francis'))).toBe(creditKey('Pixies • Black Francis'));
    });
});

describe('artistCreditsOverlap', () => {
    it('finds an act inside a joined credit, either way round', () => {
        expect(artistCreditsOverlap('cat stevens', 'yusuf / cat stevens')).toBe(true);
        expect(artistCreditsOverlap('Yusuf / Cat Stevens', 'Cat Stevens')).toBe(true);
        expect(artistCreditsOverlap('pixies', 'pixies • black francis')).toBe(true);
        expect(artistCreditsOverlap('M', 'M / Robin Scott')).toBe(true);
    });

    it('is true of two spellings of the same credit', () => {
        expect(artistCreditsOverlap('Beyoncé', 'beyonce')).toBe(true);
        expect(artistCreditsOverlap('Yusuf / Cat Stevens', 'yusuf / cat stevens')).toBe(true);
    });

    it('does not read a word of a name as an act', () => {
        expect(artistCreditsOverlap('air', 'air supply')).toBe(false);
        expect(artistCreditsOverlap('jay', 'jay-z')).toBe(false);
        expect(artistCreditsOverlap('cat', 'yusuf / cat stevens')).toBe(false);
    });

    it('does not join two credits that only share an act', () => {
        expect(artistCreditsOverlap('sly & robbie', 'sly & the family stone')).toBe(false);
    });

    it('wants the inner credit whole and in order', () => {
        expect(artistCreditsOverlap('Sly & Robbie', 'Sly & Robbie, Grace Jones')).toBe(true);
        expect(artistCreditsOverlap('Robbie & Sly', 'Sly & Robbie, Grace Jones')).toBe(false);
    });

    it('overlaps nothing with an empty credit', () => {
        expect(artistCreditsOverlap('', '')).toBe(false);
        expect(artistCreditsOverlap('', 'Cat Stevens')).toBe(false);
    });
});

describe('spacingKeys and isArtistHeld', () => {
    it('holds the key alone for one act, and the credit beside it for a joined one', () => {
        expect(spacingKeys('Cat Stevens')).toEqual(['cat stevens']);
        expect(spacingKeys('Yusuf / Cat Stevens')).toEqual(['yusuf cat stevens', 'yusuf / cat stevens']);
    });

    it('holds an act inside a joined credit that aired, and the joined credit after the act', () => {
        const joined = new Set(spacingKeys('Yusuf / Cat Stevens'));
        expect(isArtistHeld(joined, artistKey(['Cat Stevens']), creditKey('Cat Stevens'))).toBe(true);
        expect(isArtistHeld(joined, artistKey(['Cat Stevens']))).toBe(true);

        const act = new Set(spacingKeys('Cat Stevens'));
        expect(isArtistHeld(act, artistKey(['Yusuf / Cat Stevens']), creditKey('Yusuf / Cat Stevens'))).toBe(true);
    });

    it('holds nothing it should not', () => {
        const held = new Set([...spacingKeys('Air'), ...spacingKeys('Sly & Robbie')]);
        expect(isArtistHeld(held, artistKey(['Air Supply']), creditKey('Air Supply'))).toBe(false);
        expect(isArtistHeld(held, artistKey(['Sly & the Family Stone']), creditKey('Sly & the Family Stone'))).toBe(false);
        expect(isArtistHeld(held, '', '')).toBe(false);
    });
});

describe('sameAct', () => {
    it('is the key, or overlapping credits', () => {
        const act = (name: string) => ({ artistKey: artistKey([name]), creditKey: creditKey(name) });
        expect(sameAct(act('Cat Stevens'), act('Yusuf / Cat Stevens'))).toBe(true);
        expect(sameAct(act('Air'), act('Air Supply'))).toBe(false);
        expect(sameAct({ artistKey: artistKey(['Cat Stevens']) }, { artistKey: 'yusuf / cat stevens' })).toBe(true);
    });
});

describe('a tail act the library knows', () => {
    const known = new Set(['mira stone']);

    it('asks only about the acts inside joined credits', () => {
        expect(actsInJoinedCredits(['Ada Vale & Mira Stone', 'Portishead', 'yusuf / cat stevens'])).toEqual([
            'ada vale',
            'mira stone',
            'yusuf',
            'cat stevens',
        ]);
        expect(actsInJoinedCredits(['Portishead', 'Air Supply'])).toEqual([]);
    });

    it('names the known acts of a joined credit, and nothing for one naming a single act', () => {
        expect(knownActsOf('Ada Vale & Mira Stone', known)).toEqual(['mira stone']);
        expect(knownActsOf('Mira Stone', known)).toBeUndefined();
        expect(knownActsOf('Sly & Robbie', known)).toBeUndefined();
    });

    it('holds the act against a credit that names it in another position', () => {
        const held = withKnownActs(new Set(spacingKeys('Ada Vale & Mira Stone')), known);

        expect(isArtistHeld(held, artistKey(['Mira Stone & Theo Park']), creditKey('Mira Stone & Theo Park'))).toBe(true);
        expect(isArtistHeld(held, artistKey(['Juno Reyes & Mira Stone']), creditKey('Juno Reyes & Mira Stone'))).toBe(true);
    });

    it('holds nothing extra for an act the library does not know', () => {
        const held = withKnownActs(new Set(spacingKeys('Ada Vale & Mira Stone')), new Set());

        expect(isArtistHeld(held, artistKey(['Mira Stone & Theo Park']), creditKey('Mira Stone & Theo Park'))).toBe(false);
    });

    it('still keeps a shared first act apart when the library does not know it', () => {
        const held = withKnownActs(new Set(spacingKeys('Sly & Robbie')), known);

        expect(isArtistHeld(held, artistKey(['Sly & the Family Stone']), creditKey('Sly & the Family Stone'))).toBe(false);
    });

    it('makes two candidates naming the same known act one act', () => {
        const a = { artistKey: artistKey(['A & Mira Stone']), creditKey: creditKey('A & Mira Stone'), acts: ['mira stone'] };
        const b = { artistKey: artistKey(['Mira Stone & B']), creditKey: creditKey('Mira Stone & B'), acts: ['mira stone'] };

        expect(sameAct(a, b)).toBe(true);
        expect(sameAct({ ...a, acts: undefined }, { ...b, acts: undefined })).toBe(false);
    });
});
