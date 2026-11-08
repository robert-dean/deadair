/**
 * German number words, read where a German weather break says a measurement in them.
 *
 * The weather figure guard (`weather.figures.ts`) compares every number a script states with the
 * reading it was written from. It read digits only, and a German station's model writes figures as
 * words often enough to matter: off a reading of wind at 12 km/h, `gemma4` wrote "zwanzig Kilometer
 * pro Stunde Wind" in four or five breaks of twenty, and the guard passed every one. This is the half
 * that lets it read them.
 *
 * ## Only a word that is a MEASUREMENT is read, and that is the whole of the design
 *
 * A digit in a German script is almost always a figure, because the times and dates written in digits
 * are taken out before anything is read (`21.30 Uhr`, `am 24. September`). A number WORD is not: "in
 * drei Stunden", "um zwölf", "seit zwei Tagen", "Platz eins" and "ein" as the article are all ordinary
 * speech, and the times in an outlook note are written in words on purpose. Read anywhere, every one
 * of them would be a figure nobody measured, and a refused weather break is a dropped one.
 *
 * So a number word is a figure when it says it is one, and in no other case:
 *
 * - **It is followed by a unit**: Grad, °, Prozent, %, Kilometer (pro Stunde), km/h, Stundenkilometer,
 *   Meilen, mph, Millimeter, mm, Liter, Knoten. "zwölf Grad", "zwanzig Kilometer pro Stunde".
 * - **It is one end of a range that is**: "drei bis fünf Grad", "zwischen zehn und zwölf Grad", "von
 *   fünf auf zehn Grad". Every end is checked, as a digit range's ends are.
 * - **It carries a sign in words**: "minus fünf", "plus drei". A sign is said only about a figure.
 *
 * What that costs is a spelled-out figure with no unit after it ("es werden heute zwanzig"), and a
 * unit said before the number ("Windstärke fünf"). Both get through, which is the gap the guard
 * already had for every spelled-out figure; this narrows it to those.
 *
 * The bare article "ein" is read only in front of a unit, where it is a figure ("ein Grad"); "einen",
 * "eine" and "einem" are never read at all. Ordinals ("am zwanzigsten") are not cardinals and are left
 * alone by the word boundary, and a decimal said in words ("siebzehn Komma fünf Grad") is one figure,
 * for the same reason "17,5 Grad" is.
 */

/** A number as a German script said it in words, where it sits, and what it is. */
export interface GermanFigure {
    text: string;
    index: number;
    value: number;
    /** Whether it said which side of zero it is on, "minus" or "plus". */
    signed: boolean;
}

/** The figures in a German script said in words, in the order they were said. */
export function germanFigures(script: string): GermanFigure[] {
    const figures: GermanFigure[] = [];

    for (const chain of script.matchAll(CHAIN)) {
        // The unit is the chain's last group, after the three each number word brings with it.
        const [text, unit] = [chain[0], chain[chain.length - 1]];
        const members = [...text.matchAll(ONE)];
        const anchored = unit !== undefined || members.some(member => member[1] !== undefined);
        if (!anchored) continue;

        for (const member of members) {
            const sign = member[1]?.toLowerCase();
            const whole = germanNumber(member[2] ?? '');
            const fraction = member[3] === undefined ? 0 : (germanNumber(member[3]) ?? 0) / 10;
            if (whole === undefined) continue;

            const size = whole + fraction;
            figures.push({
                text: member[0],
                index: (chain.index ?? 0) + (member.index ?? 0),
                value: sign === 'minus' ? -size : size,
                signed: sign !== undefined,
            });
        }
    }

    return figures;
}

/**
 * The value of one German number word from null to neunhundertneunundneunzig, or `undefined` when it
 * is not one. Exported for the tests, which pin the compounds one by one.
 */
export function germanNumber(word: string): number | undefined {
    let rest = word.toLowerCase();
    let total = 0;

    const hundred = rest.indexOf('hundert');
    if (hundred >= 0) {
        const times = hundred === 0 ? 1 : UNITS[rest.slice(0, hundred)];
        if (times === undefined) return undefined;
        total = times * 100;
        rest = rest.slice(hundred + 'hundert'.length).replace(/^und/, '');
        if (rest === '') return total;
    }

    const plain = UNITS[rest] ?? TENS[rest];
    if (plain !== undefined) return total + plain;

    // "einundzwanzig": a unit, "und", a ten.
    const and = rest.indexOf('und');
    if (and <= 0) return undefined;
    const unit = UNITS[rest.slice(0, and)];
    const ten = TENS[rest.slice(and + 'und'.length)];
    return unit === undefined || ten === undefined || unit > 9 || unit === 0 ? undefined : total + unit + ten;
}

const UNITS: Record<string, number> = {
    null: 0,
    ein: 1,
    eins: 1,
    zwei: 2,
    zwo: 2,
    drei: 3,
    vier: 4,
    fünf: 5,
    fuenf: 5,
    sechs: 6,
    sieben: 7,
    acht: 8,
    neun: 9,
    zehn: 10,
    elf: 11,
    zwölf: 12,
    zwoelf: 12,
    dreizehn: 13,
    vierzehn: 14,
    fünfzehn: 15,
    fuenfzehn: 15,
    sechzehn: 16,
    siebzehn: 17,
    achtzehn: 18,
    neunzehn: 19,
};

const TENS: Record<string, number> = {
    zwanzig: 20,
    dreißig: 30,
    dreissig: 30,
    vierzig: 40,
    fünfzig: 50,
    fuenfzig: 50,
    sechzig: 60,
    siebzig: 70,
    achtzig: 80,
    neunzig: 90,
};

const alternation = (words: readonly string[]): string => [...words].sort((a, b) => b.length - a.length).join('|');

/** The units that make a compound with a ten, "ein" rather than "eins" among them. */
const STEMS = alternation(['ein', 'zwei', 'drei', 'vier', 'fünf', 'fuenf', 'sechs', 'sieben', 'acht', 'neun']);
const BELOW_HUNDRED = `(?:(?:${STEMS})und(?:${alternation(Object.keys(TENS))})|${alternation([...Object.keys(TENS), ...Object.keys(UNITS)])})`;
const NUMBER = `(?<!\\p{L})(?:(?:${STEMS})?hundert(?:(?:und)?${BELOW_HUNDRED})?|${BELOW_HUNDRED})(?!\\p{L})`;
const DIGIT = `(?<!\\p{L})(?:null|eins|zwei|zwo|drei|vier|fünf|fuenf|sechs|sieben|acht|neun)(?!\\p{L})`;

/** One number word: its sign in words, the number, and a decimal said as "Komma" and a digit. */
const ONE_SOURCE = `(?:(?<!\\p{L})(minus|plus)\\s+)?(${NUMBER})(?:\\s+komma\\s+(${DIGIT}))?`;
const ONE = new RegExp(ONE_SOURCE, 'giu');

/** What joins the ends of a range. */
const JOIN = String.raw`(?:\s+(?:bis|und|oder|auf)\s+|\s*[-–]\s*)`;

/** A unit a measurement is said in. A word unit ends at a word boundary; a symbol needs none. */
const UNIT = String.raw`(?:(?:grad|prozent|stundenkilometer\p{L}*|kilometer\p{L}*|km\/h|km|meilen|mph|millimeter\p{L}*|mm|liter\p{L}*|knoten)(?!\p{L})|°|%)`;

/** A run of number words joined as a range, and the unit after its last, when there is one. */
const CHAIN = new RegExp(`${ONE_SOURCE}(?:${JOIN}${ONE_SOURCE})*(?:\\s*(${UNIT}))?`, 'giu');
