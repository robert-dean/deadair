/**
 * What the station asks a model to programme, and what it will accept back.
 *
 * Two pure functions and no I/O, so the interesting decisions — which are all about what the model
 * must NOT do — are testable without a model. The binding that uses them is
 * `model.set.generator.ts`. The sibling of `break.prompt.ts`, which does the same job for words.
 *
 * ## The failure this is shaped around
 *
 * `docs/todo/station-intelligence.md` §1: **the seed is not a pick.** Any prompt that puts a real,
 * well-formed record in the model's context which no tool returned invites the model to echo it
 * back as a choice. That is not hypothetical and it is not laziness on the model's part — an
 * example in a prompt reads as a demonstration of the answer format, and a well-formed one reads as
 * a correct answer.
 *
 * This prompt has exactly one such hazard: the list of records already in the running order, which
 * has to be shown so they are not chosen twice. It is the one thing here that is a real track and
 * did not come from a tool. So {@link NEVER_ECHO} states the rule, and it is stated where the list
 * is rather than only among the standing rules, because a rule fifteen lines above the thing it
 * governs is a rule about something else.
 *
 * The doc is also explicit about how NOT to word it: "never invent an id" is satisfied by echoing
 * something real, so the rule has to be about provenance rather than about invention.
 */

import type { LlmMessage } from '@deadair/plugin-sdk';
import { jsonObjects } from '#modules/shared/json.objects.js';
import type { TrackPick } from './set.generator.js';

/**
 * The rule that keeps a record shown as context from being read as a record offered.
 *
 * One constant, used wherever a real track appears in a prompt that the model did not find itself.
 * Worded about where a record CAME FROM, not about invention: a model that echoes a track from the
 * avoid list has invented nothing at all and would satisfy any rule phrased that way.
 */
export const NEVER_ECHO =
    'The records listed here are shown ONLY so you avoid them. They are not suggestions and not examples of good answers. Never choose one of them.';

/**
 * How many already-queued records are shown, at most.
 *
 * **Cut from forty**, on the same argument the style vocabulary is one line for: this is context to
 * check an answer against rather than a list to work through, and every entry is room the model
 * then does not have to think in. Forty was chosen when the list was the only thing standing
 * between a refill and a duplicate; it is not, and never was — `readPicks` and `PickResolver` drop
 * a repeat whatever the prompt said, so the list is an optimization that saves the model wasting
 * picks, and an optimization is not worth a third of the user turn.
 *
 * The number is a judgement rather than a measurement. What was measured is the correlation it
 * comes from: five captured refills, and the only one that answered was the one with an empty
 * avoid list. Four with fifteen entries each finished on `length` having made no tool call at all.
 * That is a small sample and the mechanism is unproven — see the reasoning figures now on the log
 * line, which are what will actually settle it.
 */
const MAX_AVOID_SHOWN = 12;

/** How many of the operator's likes or dislikes are shown per kind. */
const MAX_TASTE_SHOWN = 20;

/** What the operator has said about one artist or one record, as a line of the prompt. */
export interface TastePrompt {
    /** Artists to lean toward, and artists never to choose. Names only. */
    likedArtists?: readonly string[];
    dislikedArtists?: readonly string[];
    /** Songs, as `"Title" by Artist`. */
    likedTracks?: readonly string[];
    dislikedTracks?: readonly string[];
}

/** How the operator wants the station programmed. */
export interface SetPromptSettings {
    /** What the station calls itself, from `stream.title`. */
    station?: string;
    /**
     * What the station plays, in the operator's own words, from the presenting persona's `music`.
     *
     * The MUSIC half of a persona and deliberately not the rest of it: what a character sounds like
     * has nothing to do with what it programmes, and handing a record chooser a page of diction
     * would spend context on a question nobody asked it.
     *
     * **Not sent at all when the refill was briefed.** See {@link setPrompt}: a persona is what the
     * station plays when nobody said, and a brief is somebody saying.
     */
    music?: string;
    /**
     * What the operator has liked and disliked, for steering.
     *
     * In the SYSTEM turn, unlike the brief: this is a standing fact about the station rather than
     * about tonight, and it is the same on every refill. It is advice — the dislikes are enforced in
     * `PickResolver` whatever the model does, so a model that ignores this list cannot air a
     * forbidden record, it can only waste the picks it spent on one.
     */
    taste?: TastePrompt;
    /**
     * The styles the library actually answers to, commonest first, as `style (n records)`.
     *
     * The words, not the records. A style search was a blind guess at a string for as long as one
     * was possible: the model reached for the operator's own phrasing, the library search matched it
     * as one substring, and an empty answer read as an empty library. It reached for "heavy metal
     * hits" over a library holding 240 metal records.
     *
     * Nothing here is a hazard of the {@link NEVER_ECHO} kind, and it is worth saying why, because
     * this IS content in the prompt that no tool returned. A style is not a record. There is nothing
     * to echo back as a pick: the only thing that can be done with one of these words is put it in a
     * search, which is the whole point.
     *
     * In the SYSTEM turn beside {@link taste}, on the same argument — it is a standing fact about
     * this library rather than about tonight, and it is the same on every refill.
     *
     * **`total` is load-bearing and was learned the hard way.** The first version of this was a bare
     * list of the commonest forty, and a model briefed `jazz club bangers` read it as the whole
     * vocabulary: it answered "No style listed. Probably none in library. So cannot find", named
     * nothing and made no tool call at all. The library holds 30 jazz records under a style ranked
     * 49th of 762. A truncated list that does not say it is truncated is not a hint, it is a false
     * statement about what the station owns — so the count travels with it, exactly as
     * {@link tasteLines} says how many likes it did not show.
     */
    styles?: {
        /** The commonest, already formatted as `style (n records)`. */
        shown: readonly string[];
        /** How many the library has in all, so a truncated list cannot read as a complete one. */
        total: number;
    };
    /**
     * How many records by one artist this batch will actually use, from `rules.maxPerArtist`.
     *
     * A rule the station enforces whatever the model does (`capPerArtist`), sent so the model does
     * not spend picks that will be thrown away. That is the whole value of it: the cap is not a
     * question, it is arithmetic the model can do for itself once it knows the number, and the
     * alternative is a brief served correctly and then diluted by the rotation that filled in for
     * the dropped picks.
     *
     * Absent or zero sends nothing, because zero is how `capPerArtist` spells "no cap" and a
     * sentence saying at most 0 records may be used would be false in the most damaging direction.
     */
    maxPerArtist?: number;

    /**
     * Whether the station may play only records positively marked clean.
     *
     * Named for the RECORDS rather than for the language, unlike `PromptSettings.cleanLanguage` on
     * the break side. The two are genuinely different questions asked of two different jobs: a break
     * writer chooses words and this chooses records, and a rule about profanity would mean nothing
     * to a model naming titles.
     *
     * Advice, exactly like {@link taste}'s dislikes, and for the same reason: the policy is enforced
     * in `PickResolver` whatever the model does, so a model that ignores this cannot air a forbidden
     * record — it can only waste the picks it spent on one. `search_music` narrows its own library
     * half to clean copies, but a provider does not mark most of what it carries, so without this
     * line a briefed refill can spend half its answer on records that will be dropped.
     *
     * Only under `clean-only`. A preference has nothing to say here: it is settled when the COPY is
     * chosen, long after the model named the work, and the work is playable either way.
     */
    cleanOnly?: boolean;
}

/** What the model is being asked to choose between. */
export interface SetPromptRequest {
    /** How many records to name. */
    count: number;
    /** Titles already in the running order, as `"Title" by Artist`, which must not be chosen again. */
    avoid: readonly string[];
    /**
     * What the operator asked this broadcast to play, in their own words.
     *
     * In the USER turn rather than among the standing rules, because it is what this refill is for
     * and the system turn is the standing job. It is an instruction and not a record, so it carries
     * none of the {@link NEVER_ECHO} hazard the avoid list does.
     */
    brief?: string;
}

/**
 * The conversation, oldest first.
 *
 * One system turn and one user turn, split the same way `breakPrompt` splits them: the system turn
 * is the standing job and its rules, the user turn is this particular refill.
 */
export function setPrompt(request: SetPromptRequest, settings: SetPromptSettings = {}): LlmMessage[] {
    // The system turn is told whether this refill was BRIEFED, which is the one thing about a
    // particular refill that changes the standing job: a briefed broadcast has already been told
    // what it is for, so the station's own description of its music is not a second opinion to
    // weigh, it is noise.
    const briefed = (request.brief?.trim().length ?? 0) > 0;

    return [
        { role: 'system', content: systemPrompt(settings, briefed) },
        { role: 'user', content: userPrompt(request) },
    ];
}

function systemPrompt(settings: SetPromptSettings, briefed: boolean): string {
    const station = settings.station?.trim();
    const music = settings.music?.trim();

    const lines = [
        `You are programming the music for a radio station${station ? ` called ${station}` : ''}.`,
        'You choose which records play next, in the order they will play.',
        '',
        'Rules:',
        // The grounding rule, and what it forbids has narrowed to what it was always FOR.
        //
        // It read "never name a record from your own knowledge", which was right while a pick that
        // matched no catalog row was silently dropped. `PickResolver` looks a missing record up at a
        // provider and ingests it now, so a remembered record is no longer unplayable — and the
        // absolute version was costing real hours: told a style could not be searched for, and
        // forbidden to name what it knew, a model handed a brief it could not turn into a search
        // answered with nothing at all and the deterministic floor filled a briefed hour.
        //
        // What survives is the half that keeps the station honest. A search RESULT is a fact about
        // what a provider carries, spelled the way the lookup will look it up; a memory is a
        // starting point. So knowledge may name, and may never overrule: where the two disagree,
        // the provider is right, because it is the one that has to find the record afterwards.
        '- Use the search_music tool to find records. What a search returns is what the station can definitely play.',
        '- You may also name a record you know of that no search returned. The station will try to find it, and will quietly drop it if it cannot, so prefer what the searches gave you.',
        '- Never correct a search result from memory. If a search returned a record, its spelling of the title and the artist is the right one.',
        // What used to be an ORDER between two tools, now that there is one. The preference survives
        // and the decision does not: the host reads the library and the providers together and says
        // which is which on the row, so all that is left to state is what the field means.
        //
        // This is the rule the merge exists to delete. Told to search the library first and reach
        // past it when it could not fill the ask, a model briefed for a style the library does not
        // hold searched the library for one artist after another that it had ALREADY been told the
        // station does not have, and ran out of steps before it answered. It was following the rule.
        '- Each record says whether the station already owns it. An owned record is ready to play and one it does not own is fetched when you choose it, so both are safe to name — lean toward owned where the brief is served either way.',
        // The rule that decides whether a brief is served at all, and the one thing here the model's
        // own knowledge is FOR. A search is text against titles and artist names, so the operator's
        // words go in and records with those words in the title come out: "jazz club hits" returned
        // five obscure records literally titled "Jazz Club" and nothing a jazz club has ever played.
        // The grounding rule is untouched by this and worth being explicit about — knowing that a
        // brief implies Bill Evans is knowledge, naming a record because a search returned it is
        // provenance, and only the second one is what may be answered with.
        '- A brief describes a STYLE, not a search term. Searching for the operator’s own words finds records with those words in the title, which is almost never what they meant.',
        // The other half of that rule, and the half that was missing. Telling a model its words are
        // wrong without telling it which words are right leaves it guessing at a string, which is
        // what "heavy metal hits" was: two words the library knows with two it does not.
        //
        // Conditional because the sentence has to be false-proof. A station whose catalog nothing
        // has enriched has no vocabulary, and pointing at a list that is not there is worse than
        // saying nothing.
        ...(usableStyles(settings.styles).length > 0
            ? [
                  '- The commonest styles this library holds are listed at the end of this message, with how many records each has. Searching one of those words is the surest way to fill a brief.',
                  // The rule the first version of this was missing, and the one the failure turned
                  // on. A model shown forty styles and briefed `jazz club bangers` decided the
                  // library had no jazz and stopped -- no search, no answer, nothing. The list is
                  // forty of 762 and the library holds 30 jazz records.
                  //
                  // Stated as two facts rather than as encouragement, because "you may still search"
                  // reads as permission to a model that has already concluded there is no point.
                  '- That list is the commonest few, NOT all of them. A style missing from it is not a style the station lacks: search the word anyway, because the library holds hundreds of styles too small to list.',
                  '- And a search reaches records the station does not own at all, so a brief its own library genuinely cannot fill is still one you can programme. There is no brief for which the answer is nothing.',
              ]
            : []),
        '- Work out for yourself which artists fit the brief, then search for THEM by name, one at a time. That is what the searches are good at.',
        // The station had four tools and used to be told about two, so a briefed refill had exactly
        // one way to get from a style to a set of artists: whatever the model happened to remember.
        // Measured on the run that prompted this, a `heavy metal hits` refill named Lamb of God,
        // Megadeth and Metallica — which are the first three entries of the operator's OWN likes
        // list further down this prompt, not a fact about metal. Across four refills there was not
        // one call to either tool below.
        //
        // Both are stated as what they are FOR rather than as an inventory. A model reads a rule
        // saying "these tools exist" as a description and a rule saying "this is how you get from
        // one act to a dozen" as a method, and only the second changes what it does.
        '- similar_artists turns ONE artist into a dozen more that genuinely resemble them, with some of their records. Use it as soon as you have one act that fits the brief: it knows an artist’s neighbours better than you remember them, and every name it gives you is somewhere new to search.',
        // Two calls, and it is worth the words: a model that guesses a chart NAME where an id is
        // wanted gets nothing back and reads that as the station having no charts. The tool's own
        // description says this too; it is repeated here because this is where the model is deciding
        // how to spend a step, and steps are the scarce thing.
        '- browse_charts is what a word like "hits" or "popular" actually means. Call it once with no chartId to see which charts there are, then again with the one you want. A chart position is a published fact rather than a memory.',
        // The other reason to reach for it, and it is a STYLE question rather than a POPULARITY
        // one, which is why it sits beside browse_charts rather than folded into the "styles this
        // library knows" rule above: that rule is about what the STATION owns and this is about
        // what the WORLD is playing, and a brief the library cannot fill is exactly the case where
        // the second is the only honest answer.
        '- browse_charts also takes a style directly ({"style": "jazz"}), which reads the world\'s chart for that style rather than one it has to be named for. Use this for a brief the search comes up short on.',
        // The filter that used to be advertised here is gone. It was sent to the provider and did
        // not narrow anything: beside an artist's name it returned nothing at all, and on its own
        // it returned the same obscure records whatever else came with it. See `MusicSearchTool`,
        // which no longer offers it — this line went with it rather than being left to recommend a
        // parameter that is not there.
        '- search_music also takes yearFrom and yearTo. Use those for a period, never words like "80s" in the query text.',
        // Two live runs pulled this rule in opposite directions and it now states the condition
        // rather than a number of searches, which is what satisfies both.
        //
        // A flat "search several times" with no ceiling had the model spend every round it was given
        // searching and never answer: the tool loop ran out, the final turn was asked with no tools,
        // and what came back was the model still saying it wanted to search. "Three or four times,
        // then ANSWER" fixed that and introduced the opposite failure — asked for two dozen records
        // off a library holding two of the style, it searched twice, had twelve records in front of
        // it, and padded the answer to length by naming eleven of them more than once. Half a
        // briefed hour was then filled by the deterministic floor, which is the one binding that
        // cannot act on a brief at all.
        //
        // So the bound is what it is FOR — enough distinct records to choose from — and the guard
        // against the first failure is that the condition is reachable and stated as a stopping
        // rule. `ModelSetGenerator.MAX_TOOL_STEPS` is the structural ceiling underneath it, and the
        // floor still covers a run that answers short.
        '- Keep searching until you have found at least as many DIFFERENT records as you were asked to name.',
        '- Vary the searches: different artists, styles or eras. The same query returns the same records again.',
        '- As soon as you have enough to choose from, ANSWER. Do not keep searching for more.',
        // The failure this prevents is invisible from the answer, which looks complete: a repeated
        // record is discarded downstream and the station fills the gap from ordinary rotation, so a
        // model padding to length silently costs the operator the thing they asked for.
        '- Name each record ONCE. Repeating one does not fill the request; the record is discarded and the station chooses something else in its place.',
        '- If you cannot find enough, name fewer. A short answer is better than a repeated one.',
        // The rule the other stopping rules leave a hole between, and a `classic banjo` refill fell
        // straight into it. The library had no banjo, two provider searches found real records, and
        // with 12 of the 24 asked for the model was caught between "keep searching until you have as
        // many DIFFERENT records as you were asked to name" and "name fewer" — and resolved it by
        // doing neither, replying "Use more searches with other decades." That is a plan, `readPicks`
        // cannot read it, and the whole refill was lost with the records already found.
        //
        // So the shape of a reply is stated outright rather than implied by the format section
        // below, which a model reads as being about the answer it has decided to give.
        '- Every reply must be either a tool call or the final JSON array. A reply saying what you intend to search next is neither: the conversation ends there and everything you found is thrown away.',
        '- So if you have run out of searches worth trying, ANSWER with what you have. Twelve records you found is twelve the station plays; a plan to find more is nothing.',
        // The floor under that permission, and it needs one. A model briefed for a style it did not
        // recognise answered `[]` in two seconds without calling a single tool, reasoning that it
        // could "name fewer" and that fewer could be none. Naming nothing is not a short answer, it
        // is no answer -- and it is the one outcome that cannot be told apart from a broken binding.
        '- Never answer with an empty list before you have searched. Deciding the station has nothing without looking is the one mistake you can make here that costs the whole request.',
        '- Do not put two records by the same artist next to each other.',
        // The cap the station is going to apply either way, stated as what will HAPPEN — the same
        // shape as the clean rule below and the dislikes further down, and for the same reason.
        //
        // It was missing, and the adjacency rule above was the only thing in the room that sounded
        // like it covered this. Measured on a briefed refill that worked: the model named 22 records
        // and spent twelve of them on ONE artist, `capPerArtist` kept two, and the ten it dropped
        // were filled by ordinary rotation — so a brief that was served perfectly well by the model
        // still came out as a half-rotation hour. The model had a dozen other acts in hand from
        // `similar_artists` at the time, which is why this points at them rather than just refusing.
        ...(settings.maxPerArtist !== undefined && settings.maxPerArtist > 0
            ? [
                  `- At most ${settings.maxPerArtist} record${settings.maxPerArtist === 1 ? '' : 's'} by any one artist will be used. Name more and the extra ones are dropped and ordinary rotation plays instead, so a thirteenth track by your favourite act costs you a slot — spend it on another artist. similar_artists is how you find one.`,
              ]
            : []),
        '- Order them so the set flows: think about what follows what.',
        // Same shape as the dislikes below: stated as a fact about what will happen rather than as
        // a prohibition, because a model told a rule is advisory spends picks testing it.
        ...(settings.cleanOnly
            ? [
                  '- This station only plays records that have a clean version. A record that has none will be dropped and something else played instead, so naming one costs you a slot.',
              ]
            : []),
        '',
        'Answer with a JSON array and nothing else, like this:',
        '[{"title": "...", "artist": "..."}, {"title": "...", "artist": "..."}]',
        // Exactly, and it matters more since a search result can be a record the station does not
        // own: the lookup that fetches it matches on the normalized title and lead artist, so a
        // tidied-up title finds nothing where the tool's own spelling finds the record. The same
        // reason makes a remembered record worth spelling plainly — it is looked up the same way.
        'Copy each title and artist exactly as the search gave them to you. For a record you named from memory, use the plainest spelling of its title and its main artist.',
    ];

    // Dropped entirely when the operator briefed this broadcast, rather than sent with an
    // instruction to prefer the brief. That instruction was here and it was the wrong shape: a local
    // model handed "long, strange and deliberate deep cuts" AND "80s synthpop" splits the
    // difference, and the cheapest way to stop it is not to hand it both. So the precedence is
    // structural now — brief the station and the persona is purely the presenter, do not brief it
    // and the persona programmes. One rule, and no switch.
    if (music && !briefed) lines.push('', 'The station describes its music this way, and you should choose to match it:', music);
    lines.push(...styleLines(settings.styles));
    lines.push(...tasteLines(settings.taste));

    return lines.join('\n');
}

/**
 * The words the library answers to, as lines of the system turn.
 *
 * One line rather than a bullet each: forty styles as forty bullets is forty lines of a prompt whose
 * scarcest resource is room to think, and this is a vocabulary rather than a list to work through.
 * The counts ride along because they are what makes it judgeable — a model can see that a style is
 * the spine of the library or a tag two records carry, and choose whether to spend an hour on it.
 *
 * Absent entirely when there is nothing to say, which is an ordinary state: a station whose catalog
 * nothing has enriched has no vocabulary, and an empty heading is a worse answer than no heading.
 */
function styleLines(styles: SetPromptSettings['styles']): string[] {
    const shown = usableStyles(styles);
    if (shown.length === 0) return [];

    const lines = ['', 'The commonest styles in the library, with how many records each has:', shown.join(', ')];

    // The sentence the failure was made of. A model that cannot see the list is truncated treats it
    // as the library's whole vocabulary and gives up on anything missing from it, so the remainder
    // is stated as a number and as an instruction — a count alone reads as trivia.
    const rest = (styles?.total ?? 0) - shown.length;
    if (rest > 0) {
        lines.push(`The library holds ${rest} more styles than these, too small to list. If the brief is not above, search for it anyway.`);
    }
    return lines;
}

/**
 * The styles worth showing, which is the ONE test of whether there is a vocabulary at all.
 *
 * Shared by the rule that points at the list and the list itself, rather than each deciding for
 * itself, because the two disagreeing is the exact failure the conditional exists to prevent: a
 * caller that passed blanks got a rule promising a vocabulary at the end of a message that carried
 * none. Trimming here rather than at the caller keeps the prompt's contract "hand me your styles"
 * instead of "hand me your styles, tidied".
 */
function usableStyles(styles: SetPromptSettings['styles']): string[] {
    return (styles?.shown ?? []).map(style => style.trim()).filter(style => style.length > 0);
}

/**
 * What the operator likes and dislikes, as lines of the system turn.
 *
 * Four lists, each truncated with its own count so a long one does not read as a short one, and
 * each phrased as steering rather than as a rule the model is enforcing. The dislikes carry the
 * sentence that they are enforced anyway, which is there for the model's benefit rather than for a
 * reader's: a model told a list is advisory spends picks testing it, and one told the station will
 * drop those picks does not.
 *
 * Nothing here is a hazard of the {@link NEVER_ECHO} kind, which is worth being explicit about
 * because these ARE real, well-formed records that no tool returned. The liked ones are the same
 * shape as the avoid list and would be echoed just as readily — so they are worded as *artists and
 * records to look for with the tool*, never as records to name, and the grounding rule above still
 * says only a search result may be named. A liked record that is not in the library is a record the
 * model cannot find, which is the correct outcome.
 */
function tasteLines(taste: TastePrompt | undefined): string[] {
    if (!taste) return [];

    const lines: string[] = [];
    const section = (heading: string, entries: readonly string[] | undefined): void => {
        const shown = (entries ?? []).filter(entry => entry.trim().length > 0).slice(0, MAX_TASTE_SHOWN);
        if (shown.length === 0) return;

        lines.push('', heading, ...shown.map(entry => `- ${entry}`));
        if ((entries?.length ?? 0) > shown.length) lines.push(`(and ${entries!.length - shown.length} more)`);
    };

    section('The operator LIKES these artists. Search for them and lean toward them:', taste.likedArtists);
    section('The operator LIKES these records. Search for them and lean toward them:', taste.likedTracks);
    section('The operator DISLIKES these artists. Never choose them; the station drops them anyway:', taste.dislikedArtists);
    section('The operator DISLIKES these records. Never choose them; the station drops them anyway:', taste.dislikedTracks);

    return lines;
}

function userPrompt(request: SetPromptRequest): string {
    const lines = [`Choose ${request.count} records for the station to play next.`];

    const brief = request.brief?.trim();
    if (brief) {
        lines.push('', 'The operator has asked for this, and it is what these records are for:', brief);
    }

    if (request.avoid.length > 0) {
        const shown = request.avoid.slice(0, MAX_AVOID_SHOWN);
        const rest = request.avoid.length - shown.length;

        lines.push(
            '',
            // The rule travels with the list rather than living only in the standing rules above.
            `Already in the running order — do NOT choose these again. ${NEVER_ECHO}`,
            // One line rather than a bullet each, exactly as `styleLines` does it and for the same
            // reason: a bullet list reads as a set of items to work through, and this is a set to
            // check against. The separator is `; ` because every entry already contains a comma's
            // worth of structure in `"Title" by Artist`.
            shown.join('; '),
        );
        if (rest > 0) {
            // Stated so the list cannot be read as the whole running order, which would invite the
            // model to fill gaps that are not there. The same failure `styleLines` names.
            lines.push(`(and ${rest} more already queued, not listed)`);
        }
    }

    return lines.join('\n');
}

/**
 * The picks in a model's answer, or nothing.
 *
 * Deliberately forgiving about SHAPE and unforgiving about content. A parse failure costs the
 * station nothing — the chain tops up from the deterministic floor — so there is no reason to be
 * strict about whether the model wrapped its array in prose. But an entry missing a title or an
 * artist is dropped rather than repaired, because a half-named record resolves to the wrong one or
 * to nothing, and both are worse than a shorter set.
 *
 * Two formats are read, and the second is not politeness. A local model told to answer in JSON
 * frequently answers in a numbered list instead, and on a self-hosted station that is the
 * difference between a binding that works and one that declines every time.
 *
 * @param max - Never return more than this, whatever the model sent.
 */
export function readPicks(text: string, max: number): TrackPick[] {
    // A reasoning model that was told to answer with an array and thought out loud first. Same
    // treatment `readAnswer` gives a script: take what follows the last close tag.
    const answer = text.replace(/^[\s\S]*<\/think>/i, '').trim();

    const picks = fromJson(answer) ?? fromLines(answer);
    return picks.slice(0, max);
}

/**
 * Every complete JSON object in the answer, read one at a time.
 *
 * **Object by object rather than as one array, because the array is frequently unfinished.** This
 * used to `JSON.parse` the span from the first `[` to the last `]`, which is correct for a whole
 * answer and catastrophic for a truncated one: a model that hits its output ceiling mid-array leaves
 * no closing bracket, the parse throws, and the caller fell through to {@link fromLines} — which
 * applied a `Title - Artist` regex to raw JSON and split a title on the hyphen inside it. One live
 * run answered with a dozen real records and was read as two, spelled
 * `Single Version","artist":"Louis Armstrong"}, — {"title":"A Kiss To Build A Dream On`. The model
 * had done the job; the parser destroyed it, and then spent a provider lookup on each piece of
 * wreckage.
 *
 * Reading the objects independently makes truncation cost exactly the one record it interrupted.
 * That matters more than it looks, because the ceiling is hit precisely on the good runs: a model
 * that searched well has more to reason about and more to say.
 *
 * `undefined` only when there is no object at all, so the caller can tell "this is not JSON" from
 * "this is JSON holding nothing usable" and falls through to the line reader for the first alone.
 * Handing JSON to that reader is what produced the wreckage above.
 */
function fromJson(answer: string): TrackPick[] | undefined {
    const objects = jsonObjects(answer);
    // A brace with no complete object behind it is still JSON — an answer truncated before its first
    // record closes — and the line reader must not be let near it. `{` rather than `[` is the test
    // on purpose: a numbered list mentioning `[remix]` is an ordinary answer this must still read,
    // and one containing a brace is not.
    if (objects.length === 0) return answer.includes('{') ? [] : undefined;

    const picks: TrackPick[] = [];
    for (const span of objects) {
        let entry: unknown;
        try {
            entry = JSON.parse(span);
        } catch {
            // One malformed object costs itself and nothing after it, which is the whole point of
            // parsing them separately.
            continue;
        }
        if (typeof entry !== 'object' || entry === null) continue;

        const { title, artist } = entry as { title?: unknown; artist?: unknown };
        if (typeof title !== 'string' || typeof artist !== 'string') continue;
        if (title.trim().length === 0 || artist.trim().length === 0) continue;

        picks.push({ title: title.trim(), artist: artist.trim() });
    }
    return picks;
}

/**
 * A numbered or bulleted list of `Title — Artist`, which is what a model answers with when it
 * ignores the format instruction.
 *
 * Both dash characters, because a model writing about music uses whichever one it feels like, and
 * `by` as a separator because that is how the request itself is phrased. The list marker is
 * stripped first so `1. "Windowlicker" by Aphex Twin` reads the same as `- Windowlicker - Aphex Twin`.
 */
function fromLines(answer: string): TrackPick[] {
    const picks: TrackPick[] = [];

    for (const raw of answer.split('\n')) {
        const line = raw
            .trim()
            .replace(/^[-*•]\s*/, '')
            .replace(/^\d+[.)]\s*/, '');
        if (line.length === 0) continue;

        const match = /^(.+?)\s+(?:[—–-]|by)\s+(.+)$/.exec(line);
        if (!match) continue;

        const title = unquote(match[1]!);
        const artist = unquote(match[2]!);
        if (title.length === 0 || artist.length === 0) continue;

        picks.push({ title, artist });
    }
    return picks;
}

/** Strip the quotes a model puts round a title, of any of the four kinds it might reach for. */
const unquote = (value: string): string =>
    value
        .trim()
        .replace(/^["'“‘]|["'”’]$/g, '')
        .trim();
