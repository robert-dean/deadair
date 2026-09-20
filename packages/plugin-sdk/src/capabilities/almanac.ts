/**
 * The `almanac` kind. An almanac plugin answers "what happened on this date",
 * for one day of the calendar, as entries somebody else wrote.
 *
 * ## Why this is not `news`, not `enrichment` and not `search`
 *
 * Four capabilities now answer about the world rather than about records, and
 * each is asked a different question. News serves a MENU an operator assembled
 * and answers "what happened", with a de-duplication contract because the same
 * entry comes back on every poll. Search takes words the caller made up and
 * answers "what does the web say about that". Weather is asked about one PLACE
 * and answers with measurements. This is asked about one DATE and answers with
 * the same entries it answered with a year ago.
 *
 * That last property is the whole reason it is not news wearing a filter. A
 * headline is perishable and has to be de-duplicated against what was already
 * read; an entry here is fixed — 1966 does not move — and the only thing worth
 * remembering about one is whether this station has already said it today. The
 * contract a news plugin owes about stable ids is therefore absent, and so is
 * {@link NewsQuery.since}: there is no "since" for a calendar.
 *
 * It is not `enrichment` for the reason `capabilities/similarity.ts` is not:
 * enrichment describes rows the catalog holds, and a date knows nothing about
 * the library.
 *
 * ## The host decides which day it is, and the plugin never asks
 *
 * {@link AlmanacQuery} carries a month and a day rather than a date, and
 * certainly rather than nothing at all. A plugin that read its own clock would
 * be a server in one timezone deciding what day a station in another is having —
 * and the station's answer is not "today" anyway, it is "the day the break
 * AIRS", which is a question only the host can ask. A break written at ten to
 * midnight for five past is about tomorrow.
 *
 * Numbers rather than `MM-DD`, because a caller building that string is a caller
 * formatting a date, and every way of getting that wrong is silent.
 *
 * ## An entry is a claim and its own evidence
 *
 * {@link AlmanacEntry.text} is taken VERBATIM by the station's floor writer, on
 * the rule `fact.lead.ts` already keeps: a sentence somebody else published is a
 * sourced claim, and taking it whole means the claim and the quote are the same
 * span, so nothing can have been invented between them. A plugin therefore hands
 * over the source's own sentence and composes none of its own — a plugin that
 * rewrote an entry into something more broadcastable would be handing the
 * station a sentence with no source, in the one voice it uses for things that
 * are true.
 *
 * {@link AlmanacEntry.url} is where a person reads it when something sounds
 * wrong on air, which is `facts.source_url`'s reason and is the only thing that
 * makes any of this trustworthy.
 *
 * ## What the station leans toward is the STATION's business
 *
 * {@link AlmanacQuery} has no way to ask for the musicians, and that is
 * deliberate rather than an omission. A music station reading out a day's
 * history wants the guitarist before the general who won the battle, but which
 * entries are worth saying is a decision about what THIS station says, settled
 * where every other such decision is: host-side, beside the voice and the
 * phrasings. A plugin that filtered would mean the station's character depended
 * on which plugin was installed, which is the same thing
 * `capabilities/weather.ts` refuses when it keeps unit conversion out of the
 * plugins.
 *
 * What the plugin owes instead is the material to decide with:
 * {@link AlmanacSubject.description} is the line that says a person was a
 * guitarist, and a source that has one must pass it on.
 *
 * ## Nothing here airs
 *
 * An entry is a sentence somebody else wrote. Whether any of it is spoken is a
 * break writer's decision on a station that is on air, and this capability has
 * no way to reach one.
 *
 * Every shape here is JSON-safe.
 */

/**
 * What sort of thing an entry is.
 *
 * Four arms, which is what the sources agree on and what a station would say
 * differently: something that happened, somebody born, somebody who died, and a
 * day that recurs. A plugin collapses its own vocabulary onto this — Wikipedia's
 * `selected` is an `event` that its editors thought was the pick of the day, and
 * the fact that they picked it survives as {@link AlmanacEntry.notable} rather
 * than as a fifth arm nothing else could ever fill.
 *
 * `observance` rather than `holiday`, because most of what arrives under that
 * heading is not a holiday anywhere: a saint's day, an independence day one
 * country keeps, a United Nations day for something. A station saying "today is"
 * about any of those is right, and saying "it's a holiday" is not.
 */
export type AlmanacEntryKind = 'event' | 'birth' | 'death' | 'observance';

/** What an almanac source is asked. */
export interface AlmanacQuery {
    /** The month, 1 to 12. See the note on this file: the host decides which day it is. */
    month: number;
    /** The day of the month, 1 to 31. */
    day: number;
    /**
     * Which sorts of entry to include, or absent for everything the source has.
     *
     * Absent is the common call, because the caller filters afterwards and
     * cannot know in advance which kind the day's best line is in. It is here
     * for the caller that genuinely wants one — a station reading only
     * anniversaries — so that the request costs one fetch rather than a page of
     * births thrown away.
     */
    kinds?: AlmanacEntryKind[];
    /**
     * At most this many entries OF EACH KIND, or absent for whatever the source
     * gives.
     *
     * Per kind rather than overall, because an overall cap on a day with two
     * hundred births and fifty events is a cap on the births alone, and the
     * caller loses the half it was most likely to use.
     *
     * A caller here asks for a generous number on purpose: the station filters
     * what comes back and a tight limit would cut the material away before the
     * filter ever saw it. A plugin caps this at whatever its service will give
     * and answers with what it got, rather than refusing —
     * {@link WeatherQuery.days}'s rule.
     */
    limit?: number;
}

/**
 * Who or what an entry is about, as the source describes them.
 *
 * The part the station reads to decide whether an entry is for it. See the note
 * on this file: the plugin fetches and the host leans.
 */
export interface AlmanacSubject {
    /** The subject's own name, as the source writes it: `Nuno Bettencourt`, `Abbey Road`. */
    title: string;
    /**
     * The source's one-line description of them: `Portuguese guitarist`,
     * `1969 Beatles album`.
     *
     * Absent whenever the source has none, and never invented. This is the
     * field a caller's own filter reads, so a plugin dropping it makes every
     * entry from that source look like it is about nothing in particular.
     */
    description?: string;
    /** Where a person reads about them. */
    url?: string;
}

/** One thing that happened on the date, or one day that recurs on it. */
export interface AlmanacEntry {
    kind: AlmanacEntryKind;
    /**
     * The year, absent for an {@link AlmanacEntryKind} of `observance` and for a
     * source that does not carry one.
     *
     * Negative for BC, which is the arithmetic every source already does and the
     * only reading that lets a caller sort. A station is unlikely to say it.
     */
    year?: number;
    /**
     * The entry as the source published it, in one sentence.
     *
     * Read VERBATIM by the station's floor writer — see the note on this file.
     * Plain text: no markup, no footnote markers, and no trailing citation.
     */
    text: string;
    /** Where a person reads it, which is the address an operator opens when something sounds wrong on air. */
    url?: string;
    /** Who or what it is about, in the order the source lists them. Empty for a source that says only the sentence. */
    subjects?: AlmanacSubject[];
    /**
     * Whether the source itself calls this one of the day's notable entries.
     *
     * Wikipedia's front page picks a handful out of the day's events; most
     * sources pick nothing. A hint about EDITORIAL weight and not about subject,
     * so a station that leans toward its own material can still fall back to
     * what somebody else thought mattered, which is exactly what a thin day
     * needs.
     */
    notable?: boolean;
}

/** What happened on one date. */
export interface AlmanacDay {
    /**
     * The date this is about, as `MM-DD`, zero-padded. Never a `Date`, and
     * deliberately without a year.
     *
     * Echoed back rather than assumed, so a caller can tell a plugin that
     * answered about the day it asked for from one that quietly answered about
     * its own today. {@link WeatherReading.place}'s rule: the only evidence
     * anybody has that the right question was answered.
     */
    date: string;
    /**
     * Everything the source had, in whatever order it publishes.
     *
     * Not sorted here, because the two useful orders — by year and by how much
     * the source thinks of the entry — are both reconstructible from the fields,
     * and a plugin imposing one would hide the other.
     */
    entries: AlmanacEntry[];
}

/**
 * Implemented by an `almanac` plugin.
 */
export interface AlmanacProvider {
    /**
     * What happened on that date.
     *
     * `undefined` is an ordinary answer and not a failure: an unconfigured
     * plugin, a service that is down, and a date the source has nothing for are
     * one outcome to every caller, which is {@link WeatherProvider.getWeather}'s
     * rule. Throw only for something the operator has to go and fix, since the
     * host turns a throw into a line an operator reads.
     *
     * A day with entries of some kinds and none of another is NOT one of those
     * cases and is answered — a caller asking for births and events on a quiet
     * date gets the events, and deciding whether that is enough to say anything
     * is the station's business.
     */
    getDay(query: AlmanacQuery): Promise<AlmanacDay | undefined>;
}
