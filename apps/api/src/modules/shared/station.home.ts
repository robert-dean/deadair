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
