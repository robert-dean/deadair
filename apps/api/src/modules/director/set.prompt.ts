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

/** How the operator wants the station programmed. */
export interface SetPromptSettings {
    /** What the station calls itself, from `stream.title`. */
    station?: string;
    /** The operator's own line about what the station plays, from `llm.setPersona`. */
    persona?: string;
}

/** What the model is being asked to choose between. */
export interface SetPromptRequest {
    /** How many records to name. */
    count: number;
    /** Titles already in the running order, as `"Title" by Artist`, which must not be chosen again. */
    avoid: readonly string[];
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
        '- Search several times, for different artists, styles or eras, before you answer.',
        '- Do not put two records by the same artist next to each other.',
        '- Order them so the set flows: think about what follows what.',
        '',
        'Answer with a JSON array and nothing else, like this:',
        '[{"title": "...", "artist": "..."}, {"title": "...", "artist": "..."}]',
        'Copy each title and artist exactly as search_library gave them to you.',
    ];

    if (persona) lines.push('', 'The station describes its music this way, and you should choose to match it:', persona);

    return lines.join('\n');
}

function userPrompt(request: SetPromptRequest): string {
    const lines = [`Choose ${request.count} records for the station to play next.`];

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
