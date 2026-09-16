/**
 * The `narration` kind. A narration plugin answers "what has the station got to
 * read out", as text somebody else wrote.
 *
 * ## The pair it completes
 *
 * This and `capabilities/news.ts` are the two text sources, and they differ in
 * what the station DOES with the words rather than in where they came from:
 *
 * - A news plugin hands over entries and the station talks ABOUT them. What airs
 *   is the station's own sentence, written by a model, in a presenter's voice.
 * - A narration plugin hands over pieces and the station READS one, verbatim, as
 *   a programme at a clock band. No model ever writes a word of it.
 *
 * So the question to ask of a source is not what it publishes but whether its
 * words are meant to be heard as they stand. A headline is not: it is a fact to
 * mention. A chapter is: reading it out IS the programme. A source whose text
 * would need summarising is a `news` source even if it publishes books, and one
 * whose text is meant to be spoken whole belongs here even if it publishes news.
 *
 * And separate from `capabilities/podcast.ts`, the third source in this
 * neighbourhood, because a podcast plugin hands over an ADDRESS and the host
 * fetches audio somebody else made. Here the station makes the audio, which is
 * what earns it everything the station's own voice gets: the pronunciation
 * lexicon, the performance cues, the persona, a real loudness measurement rather
 * than an assumed level.
 *
 * ## It offers text, and the station speaks it
 *
 * A plugin must never synthesise. Speech is `capabilities/speech.ts`, it is
 * selected by the operator rather than by whoever wrote the text, and the
 * station holds exactly one engine slot: a second source producing audio on its
 * own schedule would compete with the presenter for the card and would arrive
 * having skipped every stage above. What crosses the boundary here is words,
 * which is also why this capability can afford to hand over the content itself
 * where `podcast` cannot. A chapter is kilobytes and an episode is a hundred
 * megabytes, so `getText` fits inside `host.fetch`'s body bounds with room to
 * spare and needs no second path for bytes.
 *
 * ## A series is carried in one of two orders, and the plugin says which
 *
 * {@link NarrationSeries.order} is the whole of it. A book is a `serial`: it
 * starts at its first chapter and the station works through it in order, once
 * each. A column is `latest`: what airs tonight is the newest issue, and a night
 * it publishes nothing is a night the band declines rather than one the station
 * fills from the archive. Getting this wrong is the difference between a book
 * read back to front and a newsletter stuck on its first issue forever, and no
 * caller can infer it, which is why it is required.
 *
 * ## `id`s are a de-duplication contract
 *
 * `news.ts`'s rule, and for a sharper reason: the station remembers which pieces
 * it has RENDERED and AIRED by {@link NarrationPiece.id}, so a plugin that
 * renumbers has the station pay to speak the same chapter twice and then air it
 * twice. A {@link NarrationSeries.id} is stable in the same way for as long as
 * the operator keeps the series.
 *
 * Every shape here is JSON-safe.
 */

/**
 * How a series is worked through.
 *
 * - `serial`: from the beginning, in {@link NarrationPiece.ordinal} order, each
 *   piece once. A book, a serialised novel, a lecture course.
 * - `latest`: the newest piece by {@link NarrationPiece.publishedAt}, and
 *   nothing once it has aired. A newsletter, a column, a blog.
 */
export type NarrationOrder = 'serial' | 'latest';

/**
 * One thing this plugin can offer to have read out: a book, a column, a queue.
 *
 * `id` is scoped to this plugin and needs to be unique only within it. The host
 * qualifies it before anything outside sees it, so a short flat id is right.
 */
export interface NarrationSeries {
    id: string;
    /** What to call it out loud, e.g. `Frankenstein`. A presenter says this when handing over. */
    title: string;
    /** How the station works through it. See {@link NarrationOrder}; no caller can guess it. */
    order: NarrationOrder;
    /** Who wrote it, as the source gives it. Said aloud beside the title, so a person rather than a slug. */
    author?: string;
    /** What the series is about, as PLAIN TEXT. It may reach a model's context and a voice. */
    description?: string;
    /** Artwork for the console and the mount. Always http(s), and stable across calls. */
    artworkUrl?: string;
    /** Where the series lives for a person. */
    homeUrl?: string;
    /**
     * ISO 639-1, or the source's own tag (`en-gb`), when the plugin knows.
     *
     * Not decoration: the host splits a long piece at SENTENCE boundaries before
     * speaking it, and where a sentence ends is a question about the language.
     */
    language?: string;
}

/**
 * One instalment: a chapter, an issue, an article.
 *
 * What is required depends on the series' {@link NarrationSeries.order}, and a
 * piece missing the field its order needs is one the host drops, because it
 * cannot be placed in the sequence: `ordinal` for a `serial`, `publishedAt` for
 * a `latest`. Supplying both is fine and often right.
 */
export interface NarrationPiece {
    /** Stable across calls. See the de-duplication contract in this file's header. */
    id: string;
    /** The {@link NarrationSeries.id} this belongs to, as the plugin's own unqualified id. */
    seriesId: string;
    /** That series' title, so a caller reading one list can say what it is part of. */
    seriesTitle: string;
    /** What this piece is called, e.g. `Chapter 4: The laboratory`. Said aloud. */
    title: string;
    /**
     * Where it comes in a `serial`, counting from 0.
     *
     * The station's own position in the book, so it has to describe the SERIES
     * rather than this listing: the fourth chapter is `3` whether or not the
     * first three were in the answer. Ignored for a `latest` series.
     */
    ordinal?: number;
    /**
     * ISO-8601. Never a `Date`, and absent when the source published no readable one.
     *
     * What a `latest` series is ordered by, and undated pieces there never count
     * as newest: there is nothing to say they are.
     */
    publishedAt?: string;
    /**
     * What the piece is about, as PLAIN TEXT.
     *
     * The line a presenter reaches for when introducing it, which is why it has
     * to be plain. Never the text itself: that is {@link NarrationProvider.getText}.
     */
    summary?: string;
    /** The piece's page, for a person. */
    url?: string;
    /**
     * Roughly how many words it runs to.
     *
     * The only length the station has before it has spoken anything, so it is
     * what the running order is projected against while the audio is still being
     * made. A rough count is far better than none: without it a twenty-minute
     * chapter projects as nothing and every band behind it is planned an hour early.
     */
    wordCount?: number;
}

/**
 * One run of text to be spoken.
 *
 * An object rather than a bare string, deliberately. Everything the station
 * currently does needs only `text`, and a `string[]` would say so more simply.
 * But the next thing anybody will want is a piece with more than one voice in
 * it (a play, a dialogue, a letters page read by two presenters), and that wants
 * a `role` beside the words. Adding a field to an object is a change every
 * plugin already written survives; replacing a `string` with an object is not.
 *
 * Split the text the way it READS: a paragraph per part. The host packs parts
 * into as few speech calls as the engine's own limit allows, and it may split
 * inside one that is too long, but it never joins across a boundary you drew
 * without the pause a paragraph implies.
 */
export interface NarrationPart {
    /**
     * PLAIN TEXT, and what the station will say out loud, exactly as it stands.
     *
     * Two things to strip before handing it over, because nothing downstream
     * can tell them from the prose. Editorial furniture (`[Illustration: …]`,
     * `[Footnote 12]`, page numbers, running heads) is not the author's words
     * and a listener has no idea what to do with it. And square brackets in
     * particular are how the station marks a performance cue and a sound effect
     * in a script, so bracketed text reaching the speech path is read as an
     * instruction rather than as words: at best it vanishes, at worst the
     * presenter coughs in the middle of a sentence.
     */
    text: string;
}

/** The words of one piece. */
export interface NarrationText {
    /** In reading order. An empty array is not a piece the station can air. */
    parts: NarrationPart[];
}

/** What a narration source is asked when the host wants a series' instalments. */
export interface NarrationPiecesQuery {
    /** A {@link NarrationSeries.id} this plugin offered. */
    seriesId: string;
    /** How many to return. A plugin may return fewer; it must not return more. */
    limit: number;
}

/** What a narration source is asked when the station is ready to speak one. */
export interface NarrationTextQuery {
    seriesId: string;
    /** A {@link NarrationPiece.id} this plugin offered for that series. */
    pieceId: string;
}

/**
 * Implemented by a `narration` plugin.
 */
export interface NarrationProvider {
    /**
     * What this plugin can offer, right now.
     *
     * Asked per call rather than cached by the host, for the reason
     * `NewsProvider.listFeeds` is: an operator editing a series list
     * reinitializes the plugin, and a list built from a config field would
     * otherwise be a boot snapshot of a setting that has since changed.
     *
     * An empty array is an ordinary answer. A plugin nobody has pointed at
     * anything yet has nothing to offer, and that is not a failure.
     */
    listSeries(): Promise<NarrationSeries[]>;

    /**
     * A series' pieces, in the order that series is worked through: a `serial`
     * from its beginning, a `latest` newest first.
     *
     * The station keeps what it is told here, so a `serial` must be answered
     * from the START rather than from wherever the station has reached: it is
     * the table of contents, not a cursor, and the host is the one that knows
     * which pieces have aired. `limit` is the host's page size and a serial
     * longer than it is read across calls.
     *
     * Return `[]` for a `seriesId` you do not recognise rather than throwing,
     * since the host asks the plugin that named the id and an unknown one is a
     * stale request. The same goes for a series that could not be read: one
     * failing series must not cost the others.
     */
    listPieces(query: NarrationPiecesQuery): Promise<NarrationPiece[]>;

    /**
     * The words of one piece, fetched when the station is about to speak it.
     *
     * Separate from {@link listPieces} because of what each costs: a listing is
     * read whenever a console page opens, and a piece is a whole chapter, wanted
     * once in its life. Handing the text over with the listing would mean
     * carrying a book every time somebody looked at a menu.
     *
     * `undefined` for a piece you cannot produce text for, which the host
     * records as a failure against that piece and moves on. Do not answer with
     * an empty {@link NarrationText} to mean the same thing: an empty piece is
     * indistinguishable from a chapter of blank pages, and the station reports
     * the two differently.
     *
     * This one call may take a while, since a source that has to be fetched and
     * parsed is the normal case, and the host gives it a budget to match: far
     * longer than a listing gets. Watch `host.signal` and give up when it does.
     */
    getText(query: NarrationTextQuery): Promise<NarrationText | undefined>;
}
