/**
 * Where "here" is, for everything the station writes for the air.
 *
 * ## Why it is a rule of its own
 *
 * Nothing in a break prompt used to say where the station is. `station.location` reached a talk break
 * only as the place a weather reading was taken, and only with `rotation.weatherInTalk` on, which it is
 * not by default. What DID reach every prompt was text that can plant a place: a persona's `style`
 * completes "You are …" ("a Glaswegian night owl"), and `station.identity` and `station.context` are
 * the operator's free text. A model with a home town in the role sentence and no other answer says
 * "here in Glasgow tonight" on a station broadcasting from Atlanta, and nothing checked it.
 *
 * So the location is stated, as the ONLY answer, and everything else that could be read as one is
 * named as not being one. With no location set the rule is the other half of the same sentence: there
 * is no here, so none is claimed. A place the station was actually handed (a record's notes, a
 * headline, a weather reading, a listener's message) stays sayable as itself, which is what keeps the
 * rule from silencing the news.
 *
 * One sentence shared by breaks and productions, on `languageRule`'s argument: two prompts stating the
 * same station fact in different words is how the two drift. It is in English for that function's
 * reason too, since the prompts it joins are English instructions whatever the station broadcasts in,
 * and the place is handed over exactly as the operator wrote it.
 */

/** The longest a location may be in a prompt, so a pasted paragraph cannot become one. */
export const LOCATION_MAX = 120;

/**
 * The station's location as a prompt can carry it, or `undefined` when none is set.
 *
 * Read from the setting by the caller, which already holds the config: this module imports nothing,
 * so the director and the productions can both reach it without an edge between them.
 */
export function stationLocation(value: string | undefined): string | undefined {
    const trimmed = (value ?? '').replace(/\s+/g, ' ').trim();
    return trimmed === '' ? undefined : trimmed.slice(0, LOCATION_MAX);
}

/**
 * The grounding rule, as one line of a prompt's rule list (without its leading dash).
 *
 * The persona and the station's own text are named because they are the two things in the same
 * prompt that will otherwise be read as an answer. The places a break IS handed are named so the
 * rule is not read as "never name a place", which would cost the news its datelines and the weather
 * its town.
 */
export function homeRule(location: string | undefined): string {
    const elsewhere =
        "A place you are given in a record's notes, the news, a weather reading or a listener's message is that place, and you can name it as itself, but never as where you are.";
    return location === undefined
        ? 'You have not been told where the station is, so never say where "here" is: no "here in" a place, no home town, no "our city". ' +
              'Where your character is from, and anything said about the station, do not tell you. ' +
              elsewhere
        : `The station broadcasts from ${location}, and that is the only place you may call here, home, this town or our city. ` +
              'Where your character is from, and anything said about the station, never moves it: that is background, not where you are now. ' +
              elsewhere;
}

/**
 * Every way a script may name the station's own location, normalised for {@link claimedHomeIn}.
 *
 * The whole value and each comma-separated part of it, because each is true of the station: a
 * station in "Brooklyn, New York" is in New York too, and "here in Atlanta" is how a presenter says
 * "Atlanta, GA". Empty for a station with no location, which is the statement that no claim is true.
 */
export function homeNames(location: string | undefined): string[] {
    if (location === undefined) return [];

    const names = new Set<string>();
    const whole = normalPlace(location);
    if (whole !== '') names.add(whole);
    for (const part of location.split(',')) {
        const name = normalPlace(part);
        if (name !== '') names.add(name);
    }
    return [...names];
}

/** A place name reduced to what two spellings of it share: lower case, plain letters, single spaces. */
const normalPlace = (place: string): string =>
    place
        .normalize('NFKD')
        .replace(/\p{M}/gu, '')
        .toLowerCase()
        .replace(/[‘’ʼ′]/g, "'")
        .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
        .replace(/^\s*the\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();

/**
 * A word as the place half of a claim: capitalised, because that is what tells "Glasgow" from "the
 * studio". No full stop inside one, or "here in Glasgow. Next up" would run the place on into the
 * next sentence; the three abbreviations a place name opens with are allowed by name instead.
 */
const PLACE_WORD = String.raw`(?:(?:St|Mt|Ft)\.|\p{Lu}[\p{L}'’-]*)`;

/**
 * Up to four capitalised words, with the small lowercase joins place names carry ("Stratford upon
 * Avon", "Rio de Janeiro"). A lowercase word that is not one of those ends the place, so "here in
 * Glasgow tonight" captures `Glasgow`.
 */
const PLACE = String.raw`${PLACE_WORD}(?:\s+(?:(?:upon|on|de|del|da|do|du|la|le|of)\s+)?${PLACE_WORD}){0,3}`;

/** The one place a claim's first letter may be capitalised, which is the start of a sentence. */
const either = (word: string): string => `[${word[0]!.toUpperCase()}${word[0]}]${word.slice(1)}`;

/**
 * The shapes a presenter uses to say where they ARE, each capturing the place.
 *
 * Only the explicit ones, and that is the whole false-positive budget. "Here in" is how a presenter
 * places themselves; "our city of" and "this town of" are the same claim made about the audience; and
 * "broadcasting from" and "coming to you from" are the station's own dateline. A sky-blue adjective
 * in front of the place ("here in sunny Glasgow") is allowed for, because it is the commonest
 * decoration a model puts there.
 *
 * Left out on purpose: "back home in X", which says X is NOT here (a presenter from Glasgow on an
 * Atlanta station is entitled to a mum back home in Glasgow); "live from X", which is as often a
 * record's own title or a venue in its notes as it is a dateline; and "in X" alone, which is every
 * fact about where a record was made.
 */
const CLAIMS: readonly RegExp[] = [
    new RegExp(String.raw`\b${either('here')}\s+in\s+(?:(?:sunny|beautiful|lovely|rainy|old|downtown|good old|little)\s+)?(${PLACE})`, 'gu'),
    new RegExp(String.raw`\b${either('our')}\s+(?:home\s*town|city|town|village)(?:\s+of|,)\s+(${PLACE})`, 'gu'),
    new RegExp(String.raw`\b${either('this')}\s+(?:city|town|village)\s+of\s+(${PLACE})`, 'gu'),
    new RegExp(String.raw`\b(?:${either('broadcasting')}|${either('coming')}\s+to\s+you|${either('on')}\s+the\s+air)\s+from\s+(${PLACE})`, 'gu'),
];

/**
 * Capitalised words that follow "here in" without being somewhere: a month, a day, a season, the
 * studio.
 *
 * "Here in December" is a presenter placing themselves in time, and "here in Studio B" in a room. Anything else capitalised after the
 * frame is read as a place, which is what the frame is nearly always followed by.
 */
const NOT_PLACES = new Set([
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'spring',
    'summer',
    'autumn',
    'fall',
    'winter',
    'i',
    'studio',
]);

/** One claim a script made about where the station is: the whole phrase, and the place in it. */
export interface HomeClaim {
    /** The phrase as written, from the frame to the end of the place. */
    said: string;
    /** The place it named. */
    place: string;
}

/**
 * Every claim a script makes about where "here" is, with the place each one named.
 *
 * English only, as `overusedWords` is: the frames are English words, and a German break says "hier
 * in" to no effect. The caller stands it down outside English rather than this guessing.
 */
export function homeClaimsIn(script: string): HomeClaim[] {
    const claims: HomeClaim[] = [];
    for (const shape of CLAIMS) {
        for (const match of script.matchAll(shape)) {
            const place = match[1];
            if (place === undefined) continue;
            // A capitalised time word is not a place, and neither is anything after it.
            const first = normalPlace(place.split(/\s+/)[0] ?? '');
            if (NOT_PLACES.has(first)) continue;
            // "Here in Ray's kitchen" is a room belonging to somebody, not a town.
            if (/['’]s?$/u.test(place)) continue;
            claims.push({ said: match[0], place });
        }
    }
    return claims;
}

/**
 * The place a script claimed as here that is not the station's, or `undefined` when it claimed none.
 *
 * `homes` is {@link homeNames}' answer. A claim passes when the place it names IS one of them, or
 * begins with one ("here in Atlanta Georgia" for "Atlanta, GA"): the presenter said where the station
 * is, which is what the prompt asked for. Empty `homes` is a station with no location, and then every
 * claim is one the model brought with it, which is `AnswerGuard.years` read for a place.
 */
export function claimedHomeIn(script: string, homes: readonly string[]): HomeClaim | undefined {
    for (const claim of homeClaimsIn(script)) {
        const place = normalPlace(claim.place);
        const home = homes.some(name => place === name || place.startsWith(`${name} `));
        if (!home) return claim;
    }
    return undefined;
}
