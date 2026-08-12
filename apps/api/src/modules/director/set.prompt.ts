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
    /** The operator's own line about what the station plays, from `llm.setPersona`. */
    persona?: string;
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
    return [
        { role: 'system', content: systemPrompt(settings) },
        { role: 'user', content: userPrompt(request) },
    ];
}

function systemPrompt(settings: SetPromptSettings): string {
    const station = settings.station?.trim();
    const persona = settings.persona?.trim();

    const lines = [
        `You are programming the music for a radio station${station ? ` called ${station}` : ''}.`,
        'You choose which records play next, in the order they will play.',
        '',
        'Rules:',
        // The grounding rule. Everything else here is taste; this one is what makes the answer
        // usable at all, because a name the catalog has never seen resolves to nothing and is
        // dropped, and the running order silently comes up short.
        '- You MUST use the search_library tool to find records. Only name records it returned to you.',
        '- Never name a record from your own knowledge. If search_library did not return it, the station cannot play it.',
        // Bounded rather than encouraged, which is the correction a live run forced. "Search
        // several times" with no ceiling had the model spend every round it was given searching and
        // never answer at all: the tool loop ran out, the final turn was asked with no tools, and
        // what came back was the model still saying it wanted to search. A DJ does not need to have
        // read the whole library to pick an hour of it.
        '- Search three or four times, for different artists, styles or eras, and then ANSWER.',
        '- Do not keep searching for more. Choose from what the searches have already returned.',
        '- Do not put two records by the same artist next to each other.',
        '- Order them so the set flows: think about what follows what.',
        '',
        'Answer with a JSON array and nothing else, like this:',
        '[{"title": "...", "artist": "..."}, {"title": "...", "artist": "..."}]',
        'Copy each title and artist exactly as search_library gave them to you.',
    ];

    if (persona) lines.push('', 'The station describes its music this way, and you should choose to match it:', persona);
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
        lines.push(
            '',
            'The operator has asked for this, and it is what these records are for:',
            brief,
            // Said explicitly because the two genuinely can disagree — a station whose persona is
            // ambient and whose operator asked for heavy metal — and the operator is the one in the
            // room. The persona is a standing description; this is somebody deciding tonight.
            'Where this and the station description disagree, follow this.',
        );
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
 * The first JSON array in the answer, if it holds anything usable.
 *
 * Located by bracket rather than by parsing the whole answer, because a model that wrote "Here you
 * go:" before the array produced a perfectly good array that `JSON.parse` will not touch.
 * `undefined` rather than `[]` on a miss, so the caller can tell "no array here" from "an array of
 * nothing usable" and only fall through to the line reader for the first.
 */
function fromJson(answer: string): TrackPick[] | undefined {
    const start = answer.indexOf('[');
    const end = answer.lastIndexOf(']');
    if (start < 0 || end <= start) return undefined;

    let parsed: unknown;
    try {
        parsed = JSON.parse(answer.slice(start, end + 1));
    } catch {
        return undefined;
    }
    if (!Array.isArray(parsed)) return undefined;

    const picks: TrackPick[] = [];
    for (const entry of parsed) {
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
const unquote = (value: string): string => value.trim().replace(/^["'“‘]|["'”’]$/g, '').trim();
