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

/** How many already-queued records are shown, at most. */
const MAX_AVOID_SHOWN = 40;

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
        '- Use the search_library and search_catalog tools to find records. What a search returns is what the station can definitely play.',
        '- You may also name a record you know of that no search returned. The station will try to find it, and will quietly drop it if it cannot, so prefer what the searches gave you.',
        '- Never correct a search result from memory. If a search returned a record, its spelling of the title and the artist is the right one.',
        // The preference, stated as an order rather than as a prohibition. Library records are
        // already owned, already measured and cost nothing to play; a provider record costs a
        // lookup and a download. Both air, so this is about cost and not about permission.
        '- Search the library FIRST. Use search_catalog when the library cannot fill what you were asked for.',
        // The rule that decides whether a brief is served at all, and the one thing here the model's
        // own knowledge is FOR. A search is text against titles and artist names, so the operator's
        // words go in and records with those words in the title come out: "jazz club hits" returned
        // five obscure records literally titled "Jazz Club" and nothing a jazz club has ever played.
        // The grounding rule is untouched by this and worth being explicit about — knowing that a
        // brief implies Bill Evans is knowledge, naming a record because a search returned it is
        // provenance, and only the second one is what may be answered with.
        '- A brief describes a STYLE, not a search term. Searching for the operator’s own words finds records with those words in the title, which is almost never what they meant.',
        '- Work out for yourself which artists fit the brief, then search for THEM by name, one at a time. That is what the searches are good at.',
        // The filter that used to be advertised here is gone. It was sent to the provider and did
        // not narrow anything: beside an artist's name it returned nothing at all, and on its own
        // it returned the same obscure records whatever else came with it. See `CatalogSearchTool`,
        // which no longer offers it — this line went with it rather than being left to recommend a
        // parameter that is not there.
        '- search_catalog also takes yearFrom and yearTo. Use those for a period, never words like "80s" in the query text.',
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
        '- Do not put two records by the same artist next to each other.',
        '- Order them so the set flows: think about what follows what.',
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
    lines.push(...tasteLines(settings.taste));

    return lines.join('\n');
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
        lines.push(
            '',
            // The rule travels with the list rather than living only in the standing rules above.
            `Already in the running order — do NOT choose these again. ${NEVER_ECHO}`,
            ...shown.map(entry => `- ${entry}`),
        );
        if (request.avoid.length > shown.length) {
            lines.push(`(and ${request.avoid.length - shown.length} more)`);
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
 * The complete `{...}` spans in a string, ignoring braces inside JSON strings.
 *
 * A scanner rather than a regex because a title legitimately contains a brace, a quote or an escaped
 * quote, and because the LAST object is the one that matters here: it is where a truncated answer
 * stops, and an unterminated span must be left out rather than half-read.
 *
 * Depth is tracked so a nested brace closes its own object rather than its parent's, which means
 * what comes back is the OUTERMOST objects. That is right for the shape the prompt asks for — a flat
 * array of `{title, artist}` — and is why an answer wrapped in `{"picks": [...]}` would read as one
 * unusable object rather than as its contents. Nothing produces that shape, and the fix if anything
 * ever does is to ask this for depth-1 spans, not to unwrap here.
 */
function jsonObjects(text: string): string[] {
    const spans: string[] = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < text.length; index += 1) {
        const character = text[index]!;

        if (inString) {
            if (escaped) escaped = false;
            else if (character === '\\') escaped = true;
            else if (character === '"') inString = false;
            continue;
        }

        if (character === '"') inString = true;
        else if (character === '{') {
            if (depth === 0) start = index;
            depth += 1;
        } else if (character === '}' && depth > 0) {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                spans.push(text.slice(start, index + 1));
                start = -1;
            }
        }
    }

    return spans;
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
