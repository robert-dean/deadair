// When two wordings of a news story are one story. The pairs are modelled on ones the station's own
// roster carried on 2026-11-06 and 2026-11-07, teasers reworded, so each test is a case the rule was
// set against rather than one invented to pass it.

import { describe, expect, it } from 'vitest';

import {
    joins,
    readsNames,
    sameStory,
    signatureOf,
    storyOverlap,
    StoryRarity,
    type StorySignature,
} from '../../../src/modules/director/story.signature.js';

type Story = { headline: string; summary?: string; body?: string };

/** A day's other news, so rarity is measured against a window rather than two stories alone. */
const BACKGROUND: Story[] = [
    { headline: 'Trump allies weigh a response after the midterm losses', summary: 'Advisers to President Trump met on Thursday.' },
    { headline: 'Trump signs order on federal hiring', summary: 'The order from President Trump takes effect next month.' },
    { headline: 'Trump administration appeals ruling on tariffs', summary: 'Lawyers for the Trump administration filed late on Friday.' },
    { headline: 'Trump pick for ambassador faces questions', summary: 'Senators questioned the nominee Trump chose last week.' },
    { headline: 'Trump says he will visit the border', summary: 'The trip was announced by Trump on social media.' },
    { headline: 'Storms bring flooding to the Southeast', summary: 'Rivers rose overnight across Georgia and Tennessee.' },
    { headline: 'Scientists find a new species of deep-sea coral', summary: 'The coral was found off the coast of Chile.' },
];

const window = (...stories: Story[]): { signatures: StorySignature[]; rarity: StoryRarity } => {
    const signatures = [...stories, ...BACKGROUND].map(story => signatureOf(story));
    return { signatures, rarity: new StoryRarity(signatures) };
};

const CORNELL_BBC: Story = {
    headline: "Cornell faculty pass no-confidence vote over leadership's handling of Jane Doe allegations",
    summary:
        'The resolution passed by the academic staff on Friday is largely symbolic, as the faculty have no power to remove the leadership of the university.',
};
const CORNELL_PBS: Story = {
    headline: "Cornell faculty vote 'no confidence' in university leadership after alleged fraternity gang rape",
    summary:
        "The faculty body has no power over the university's leaders, but the resolution was meant to be more than symbolic, its backers at Cornell said.",
};
const CORNELL_LAWSUIT: Story = {
    headline: '4 Cornell lawsuit defendants join effort to oust Letitia James from criminal investigation',
    summary: 'Four people named in a lawsuit over an alleged gang rape at Cornell University asked a court to remove the attorney general.',
};

describe('sameStory', () => {
    it('joins one event two newsrooms headlined differently, on one rare name and the words around it', () => {
        const { signatures, rarity } = window(CORNELL_BBC, CORNELL_PBS);
        const evidence = sameStory(signatures[0]!, signatures[1]!, rarity);

        expect(evidence?.names).toEqual(['cornell']);
        expect(evidence?.words).toEqual(expect.arrayContaining(['faculty', 'resolution', 'symbolic']));
    });

    it('joins on two rare names alone', () => {
        const { signatures, rarity } = window(
            {
                headline: "Pope in 'pretty good health' as he starts Latin America tour",
                summary: 'Pope Leo travels to Uruguay three weeks after surgery.',
            },
            {
                headline: "What to know about Pope Leo XIV's trip to Uruguay, Argentina and Peru",
                summary: 'He returns to the continent where he was a missionary.',
            },
        );

        expect(sameStory(signatures[0]!, signatures[1]!, rarity)?.names).toHaveLength(2);
    });

    it('counts one name written two ways once, so a lawsuit is not joined to a vote', () => {
        const { signatures, rarity } = window(CORNELL_LAWSUIT, CORNELL_PBS);
        const overlap = storyOverlap(signatures[0]!, signatures[1]!, rarity);

        expect(overlap.names).toHaveLength(1);
        expect(joins(overlap)).toBe(false);
    });

    it('takes no evidence from a name half the window carries', () => {
        const { signatures, rarity } = window(
            { headline: 'Trump names a new envoy to the talks in Geneva', summary: 'The envoy will lead negotiations with partners.' },
            { headline: 'Trump envoy talks stall over negotiations with partners', summary: 'Geneva talks broke up without agreement.' },
        );
        const overlap = storyOverlap(signatures[0]!, signatures[1]!, rarity);

        expect(overlap.names).not.toContain('trump');
        expect(overlap.words).not.toContain('trump');
    });

    it('needs more than one rare name and a few ordinary words', () => {
        // Measured: two stories about Elon Musk's companies shared his name and three ordinary words.
        const { signatures, rarity } = window(
            {
                headline: 'Elon Musk appears to signal the end of the road for Cybertruck',
                summary: 'Elon Musk said the next plan was building taxis.',
            },
            {
                headline: "Starlink Mobile: all the news on SpaceX's carrier ambitions",
                summary: 'The company owned by Elon Musk has a plan for building its next network.',
            },
        );

        expect(sameStory(signatures[0]!, signatures[1]!, rarity)).toBeUndefined();
    });

    it('joins on a shared vulnerability identifier alone', () => {
        const { signatures, rarity } = window(
            { headline: 'Patch now: router flaw under attack', summary: 'The bug, CVE-2026-41234, lets an attacker in remotely.' },
            { headline: 'Agency warns of exploited firmware bug', summary: 'Tracked as cve-2026-41234, it affects older models.' },
        );

        expect(sameStory(signatures[0]!, signatures[1]!, rarity)?.ids).toEqual(['cve-2026-41234']);
    });

    it('answers the same whichever story is asked first', () => {
        const { signatures, rarity } = window(CORNELL_BBC, CORNELL_PBS);

        expect(sameStory(signatures[1]!, signatures[0]!, rarity)?.names).toEqual(sameStory(signatures[0]!, signatures[1]!, rarity)?.names);
    });
});

describe('signatureOf', () => {
    it('reads no names from a Title Case headline, where every word is capitalised', () => {
        const signature = signatureOf({ headline: 'Missouri Voters Just Made It Much Harder for Lawmakers to Overturn Initiatives' });

        expect(signature.names).toEqual([]);
        expect(signature.tokens).toEqual(expect.arrayContaining(['missouri', 'voter', 'lawmaker']));
    });

    it('reads no names from a teaser that only repeats its headline', () => {
        const headline = 'Texas School Voucher Program Could Be Unrecognizable, Says Democratic Lawmaker';
        const signature = signatureOf({ headline, summary: `The post ${headline} appeared first on ProPublica.` });

        expect(signature.names).toEqual(['propublica']);
    });

    it('keeps a run of capitalised words together as one name', () => {
        const signature = signatureOf({
            headline: 'Stephen Miller will replace Susie Wiles as chief of staff',
            summary: 'The change at the White House follows the midterm losses.',
        });

        expect(signature.names).toEqual(expect.arrayContaining(['stephen miller', 'susie wile', 'white house']));
    });

    it('drops years and one-digit figures, and keeps the rest of the numbers', () => {
        const signature = signatureOf({ headline: 'Newsom will commute all 548 death sentences in 2026, 3 aides say' });

        expect(signature.tokens).toContain('548');
        expect(signature.tokens).not.toContain('2026');
        expect(signature.tokens).not.toContain('3');
    });

    it('reads no names at all for a station whose language capitalises every noun', () => {
        expect(signatureOf(CORNELL_BBC, { names: false }).names).toEqual([]);
    });

    it('is plain data, so the read log can store it as it is', () => {
        const signature = signatureOf(CORNELL_PBS);

        expect(JSON.parse(JSON.stringify(signature))).toEqual(signature);
    });
});

describe('readsNames', () => {
    it('reads names in English and in languages that capitalise only names', () => {
        expect(readsNames(undefined)).toBe(true);
        expect(readsNames('fr')).toBe(true);
        expect(readsNames('pt-br')).toBe(true);
    });

    it('reads none in German, where a capital marks every noun', () => {
        expect(readsNames('de')).toBe(false);
        expect(readsNames('de-at')).toBe(false);
    });
});
