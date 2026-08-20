// This file IS the tuning record for `CONFIDENCE_BAR`.
//
// Every case below is a real gloss out of this station's own stored articles, and the expectations
// are what a person says each one means. The bar was chosen by running all of them at 0.5, 0.55,
// 0.6, 0.65 and 0.7: at 0.5 one is WRONG (`Stevie => STEEV-lənd` goes on air), at 0.7 seven correct
// entries wait for an operator with nothing to add to them, and 0.55 to 0.65 is a flat plateau with
// 27 confident and none wrong. Anything that moves the bar has to move this table, which is the
// point of writing it out.
//
// The dangerous rows are the three at the bottom: a gloss that is about a DIFFERENT NAME. They are
// what stands between this feature and the station announcing "chih-KOH-nee" over a Madonna record.

import { describe, expect, it } from 'vitest';

import { CONFIDENCE_BAR, readGloss, resemblance } from '../../../src/modules/render/pronunciation.gloss.js';

/** An article opening, built the way the extract API hands one over. */
const article = (name: string, parenthetical: string, rest = 'is an American rock band formed in 1980.') =>
    // The leading space inside the bracket is not decoration: it is what the respelling template
    // renders as, and half of what tells this from an ordinary parenthesis of prose.
    `${name} ( ${parenthetical}) ${rest}\n\nHistory\nThe band formed in a garage.`;

/**
 * name, the parenthetical as it stands, the word the entry is about, whether it goes on air unasked.
 *
 * The last column is the measurement rather than a wish. Six of these are RIGHT and still wait for a
 * glance, because a respelling far enough from its spelling to need writing down is also far enough
 * to be hard to tell from a different name — "Laufey" against "LAY-vay" scores exactly what "Stevie"
 * against "STEEV-lənd" does, and only one of those two is about the artist. Six entries an operator
 * waves through is the price of the one that would otherwise have gone out wrong.
 */
const WHOLE_NAME: [string, string, string, boolean][] = [
    ['Slipknot', 'SLIP-not', 'Slipknot', true],
    ['Primus', 'PRY-məs', 'Primus', true],
    ['Jamiroquai', ' jə-MIRR-ə-kwy', 'Jamiroquai', true],
    ['Adele', 'ə-DEL; born 5 May 1988', 'Adele', true],
    ['Rihanna', ' ree-AN-ə; born February 20, 1988', 'Rihanna', true],
    ['Ænima', 'AH-ni-mə', 'Ænima', true],
    ['Lynyrd Skynyrd', 'LEH-nerd SKIN-nerd', 'Lynyrd Skynyrd', true],
    ['Van Halen', 'van HAY-len', 'Van Halen', true],
    ['Niall Horan', 'NY-əl HAW-rən; born 13 September 1993', 'Niall Horan', true],
    ['Alanis Morissette', 'ə-LAN-iss MORR-iss-ET; born June 1, 1974', 'Alanis Morissette', true],
    ['Bette Midler', 'bet MID-lər; born December 1, 1945', 'Bette Midler', true],
    // Right, and reviewed. Every one of these is a name whose spelling gave up on its sounds.
    ['Ne-Yo', 'NEE-yoh', 'Ne-Yo', false],
    ['Laufey', 'LAY-vay', 'Laufey', false],
    ['Kehlani', 'kay-LAH-nee; born April 24, 1995', 'Kehlani', false],
    ['Chimaira', 'ky-MEER-ə', 'Chimaira', false],
    ['Ginuwine', 'JIN-yoo-wyn', 'Ginuwine', false],
    ['De La Soul', 'DAY lah SOHL', 'De La Soul', false],
    ['Bebe Rexha', 'BEE-bee REK-sə; born August 30, 1989', 'Bebe Rexha', false],
];

/** The gloss is about ONE word of the name, and which one is not decided by position. */
const ONE_WORD: [string, string, string][] = [
    ['Adam Levine', 'lə-VEEN; born March 18, 1979', 'Levine'],
    ['Billy Joel', 'JOHL; born May 9, 1949', 'Joel'],
    ['Luther Vandross', 'VAN-drohss; April 20, 1951 – July 1, 2005', 'Vandross'],
    ['Bob Seger', 'SEE-gər; born May 6, 1945', 'Seger'],
    ['Cyndi Lauper', 'LAW-pər; born June 22, 1953', 'Lauper'],
    ['Barbra Streisand', 'STRY-sand; born April 24, 1942', 'Streisand'],
    ['Richie Sambora', 'sam-BORE-a; born July 11, 1959', 'Sambora'],
    ['Taron Egerton', ' EJ-ər-tən; born 10 November 1989', 'Egerton'],
    ['John Frusciante', 'froo-SHAHN-tay; born March 5, 1970', 'Frusciante'],
    ['Shawn Mendes', 'MEN-dez, European Portuguese: [ˈmẽdɨʃ]; born August 8, 1998', 'Mendes'],
    // The one that kills "the surname is the glossed word": this is about the FIRST name.
    ['Aretha Franklin', 'ə-REE-thə; March 25, 1942 – August 16, 2018', 'Aretha'],
    // And the one that kills "the glossed word is a whole word of the name": it is about Öyster.
    ['Blue Öyster Cult', 'OY-ster; sometimes abbreviated BÖC or BOC', 'Öyster'],
];

describe('readGloss, on every respelling this station actually holds', () => {
    it.each(WHOLE_NAME)('says %s the way its own article says to', (name, parenthetical, written, confident) => {
        const reading = readGloss(name, article(name, parenthetical));

        expect(reading?.written).toBe(written);
        expect(reading?.confident).toBe(confident);
    });

    it.each(ONE_WORD)('reads %s as a gloss of one word of the name', (name, parenthetical, written) => {
        const reading = readGloss(name, article(name, parenthetical));

        expect(reading?.written).toBe(written);
        expect(reading?.confident).toBe(true);
    });

    // The whole reason this answers with a confidence rather than an entry. Each of these reads
    // perfectly as a pronunciation and is about somebody else's name, and no rule available here can
    // tell that — only a person looking at the sentence can.
    it.each([
        ['Madonna', 'chih-KOH-nee; born August 16, 1958'],
        ['Stevie Wonder', '  STEEV-lənd; né Judkins; born May 13, 1950'],
        ['Kanye West', 'YAY; born Kanye Omari West  KAHN-yay oh-MAH-ree, June 8, 1977'],
    ])('proposes but never applies %s, whose article glosses a different name', (name, parenthetical) => {
        const reading = readGloss(name, article(name, parenthetical));

        expect(reading).toBeDefined();
        expect(reading?.confident).toBe(false);
    });
});

describe('readGloss, on what it must not do', () => {
    it('spells the schwa out, because no engine knows what lə-VEEN is', () => {
        const reading = readGloss('Adam Levine', article('Adam Levine', 'lə-VEEN; born March 18, 1979'));

        expect(reading?.spoken).toBe('luh-VEEN');
        // The evidence stays exactly as the article wrote it, schwa and all.
        expect(reading?.sourceQuote).toContain('lə-VEEN');
    });

    it('reads the quoted form, which is the one that announces itself', () => {
        const reading = readGloss('112', '112 (pronounced "one-twelve") is an American R&B group from Atlanta, Georgia.');

        expect(reading).toMatchObject({ written: '112', spoken: 'one-twelve', confident: true });
    });

    it('is about the record, not about what the release was called', () => {
        // Matched against the whole string, the best-resembling "word" of this name was `Edition)`:
        // a written form carrying a bracket, which nothing in a script will ever match and which
        // reads to an operator as a bug rather than as a proposal.
        const reading = readGloss('2112 (Deluxe Edition)', '2112 (pronounced "twenty-one twelve") is the fourth studio album by Rush.');

        expect(reading).toMatchObject({ written: '2112', spoken: 'twenty-one twelve', confident: true });
    });

    it('leaves IPA alone rather than mangling it into confident nonsense', () => {
        expect(readGloss('Robyn', 'Robyn (pronounced [ˈrɔ̌bːʏn]) is a Swedish singer.')).toBeUndefined();
    });

    it('is not fooled by an ordinary parenthetical of prose', () => {
        expect(readGloss('Bad Boy', 'Bad Boy ( an imprint of Arista Records) signed the group in 1996.')).toBeUndefined();
        expect(readGloss('Slipknot', 'Slipknot ( 12 weeks) charted that summer.')).toBeUndefined();
    });

    it('says nothing about an article that says nothing about pronunciation', () => {
        expect(readGloss('Soundgarden', 'Soundgarden was an American rock band formed in Seattle in 1984.')).toBeUndefined();
    });

    it('takes the respelling only, not the dates the lead crammed in beside it', () => {
        const reading = readGloss('Luther Vandross', article('Luther Vandross', 'VAN-drohss; April 20, 1951 – July 1, 2005'));

        expect(reading?.spoken).toBe('VAN-drohss');
    });
});

describe('resemblance', () => {
    // The property the whole choice rests on: a respelling and a spelling disagree about vowels by
    // design and agree about consonants, so the comparison has to be about the consonants.
    it('sees through the vowels a respelling was written to replace', () => {
        expect(resemblance('Aretha', 'ə-REE-thə')).toBeGreaterThanOrEqual(CONFIDENCE_BAR);
        expect(resemblance('Streisand', 'STRY-sand')).toBeGreaterThanOrEqual(CONFIDENCE_BAR);
    });

    it('is not fooled by a different name that starts the same way', () => {
        expect(resemblance('Madonna', 'chih-KOH-nee')).toBeLessThan(CONFIDENCE_BAR);
        expect(resemblance('Stevie', 'STEEV-lənd')).toBeLessThan(CONFIDENCE_BAR);
    });
});
