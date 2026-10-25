import type { LlmMessage } from '@deadair/plugin-sdk';
import { jsonObjects, withoutThinking } from '#modules/shared/json.objects.js';
import type { TrackPick } from './set.generator.js';
import type { ShortlistEntry } from './shortlist.js';

/**
 * The conversation for a refill that hands the model a numbered list (`Shortlist`), and the reader
 * for its answer.
 *
 * A prompt of its own rather than a section added to `setPrompt`, because most of that one is about
 * SEARCHING: how to turn a brief into searches, when to stop, how to copy a search result back. None
 * of it applies when the records are already in front of the model, and every line is reading a
 * model on the station's host pays for before it writes a word. This one is a few rules and a list.
 *
 * The search tool stays offered, for the one thing a list built from the brief's acts cannot hold: a
 * record the brief names by TITLE ("now and then one sinful pop hit, such as Thriller") or a style it
 * asks for in passing. A record found that way is answered as a title and an artist inside the same
 * array, and goes through `PickResolver` like any other pick.
 */

/** What the user turn needs beside the list. */
export interface ShortlistPromptRequest {
    count: number;
    brief?: string;
    era?: { from?: number; to?: number };
    lean?: readonly string[];
    list: readonly ShortlistEntry[];
}

/** What the system turn needs. */
export interface ShortlistPromptSettings {
    station?: string;
    maxPerArtist?: number;
}

export function shortlistPrompt(request: ShortlistPromptRequest, settings: ShortlistPromptSettings = {}): LlmMessage[] {
    return [
        { role: 'system', content: systemPrompt(settings) },
        { role: 'user', content: userPrompt(request) },
    ];
}

function systemPrompt(settings: ShortlistPromptSettings): string {
    const station = settings.station?.trim();
    const cap = settings.maxPerArtist;
    return [
        `You are programming the music for a radio station${station ? ` called ${station}` : ''}.`,
        'You choose which records play next, in the order they will play.',
        '',
        'You are given a numbered list of records. Every one of them can be played right now: the station has already',
        'taken out anything that played too recently, any artist who just played, and anything the operator does not want.',
        '',
        'Rules:',
        '- Choose from the list to fit what the operator asked for, and answer with the NUMBERS of the records you chose.',
        '- Spread the records across as many different artists as the list allows, and never put two by the same artist next to each other.',
        ...(cap !== undefined && cap > 0 ? [`- At most ${cap} record${cap === 1 ? '' : 's'} by any one artist will be used.`] : []),
        '- Records marked "like" an artist are neighbours of the acts the operator named. Use them to vary the hour, not to replace those acts.',
        '- Order them so the set flows: think about what follows what.',
        '- If the operator asks for a particular record or a style the list does not have, you may search for it with search_music and add it as',
        '  {"title": "...", "artist": "..."} copied exactly from the search. Do this only for what the list lacks; never search for something already on it.',
        '',
        'Answer with a JSON array and nothing else, like this:',
        '[12, 3, 40, 7]',
    ].join('\n');
}

function userPrompt(request: ShortlistPromptRequest): string {
    const lines = [`Choose ${request.count} records for the station to play next.`];

    const brief = request.brief?.trim();
    if (brief) lines.push('', 'The operator has asked for this, and it is what these records are for:', brief);

    const from = request.era?.from;
    const to = request.era?.to;
    if (from !== undefined || to !== undefined) {
        // The list is already inside the period; this is for a record the model searches for.
        lines.push(
            '',
            `This broadcast plays records first released ${from !== undefined && to !== undefined ? `between ${from} and ${to}` : from !== undefined ? `in ${from} or later` : `in ${to} or earlier`}.`,
        );
    }

    if (request.lean !== undefined && request.lean.length > 0) {
        lines.push('', `For now the station is leaning toward ${request.lean.join(', ')}.`);
    }

    lines.push('', 'The records you can choose from:', ...request.list.map((entry, index) => describe(index + 1, entry)));
    return lines.join('\n');
}

/** One numbered line: the artist and title first, then only what helps choose. */
function describe(number: number, entry: ShortlistEntry): string {
    const notes = [
        ...(entry.year === undefined ? [] : [String(entry.year)]),
        ...(entry.like === undefined ? [] : [`like ${entry.like}`]),
        entry.airedDaysAgo === undefined ? 'not played lately' : entry.airedDaysAgo === 0 ? 'played today' : `played ${entry.airedDaysAgo}d ago`,
    ];
    return `${number}. ${entry.artist} - "${entry.title}" (${notes.join(', ')})`;
}

/**
 * The picks in an answer to {@link shortlistPrompt}, in the order given, or nothing.
 *
 * Numbers are read off the list and become picks carrying the catalog id when the library holds the
 * record, so `PickResolver` takes them at their word. An object with a title and an artist is a record
 * the model searched for and is passed on as a name. A number outside the list, a record chosen twice
 * and anything else are skipped rather than repaired.
 *
 * Read from the first `[` when there is one, so a number in prose before the array ("I chose 5
 * records") is not a choice; without one, from the whole answer, because a local model told to answer
 * with an array frequently answers with a plain list instead.
 *
 * @param max - Never return more than this, whatever the model sent.
 */
export function readChoices(text: string, list: readonly ShortlistEntry[], max: number): TrackPick[] {
    const answer = withoutThinking(text);
    const open = answer.indexOf('[');
    const region = open < 0 ? answer : answer.slice(open);

    const picks: TrackPick[] = [];
    const taken = new Set<string>();
    const take = (pick: TrackPick): void => {
        const key = `${pick.artist}\u0000${pick.title}`.toLowerCase();
        if (taken.has(key) || picks.length >= max) return;
        taken.add(key);
        picks.push(pick);
    };

    // Objects first found by the shared scanner, so a brace inside a quoted title cannot split one.
    const objects = jsonObjects(region);
    let rest = region;
    for (const object of objects) rest = rest.replace(object, ` @object${objects.indexOf(object)}@ `);

    for (const token of rest.match(/@object\d+@|(?<![\d.])\d{1,3}(?![\d.])/g) ?? []) {
        if (token.startsWith('@object')) {
            const named = fromObject(objects[Number(token.slice('@object'.length, -1))]!);
            if (named !== undefined) take(named);
            continue;
        }
        const entry = list[Number(token) - 1];
        if (entry === undefined) continue;
        take({ title: entry.title, artist: entry.artist, ...(entry.trackId === undefined ? {} : { trackId: entry.trackId }) });
    }
    return picks;
}

function fromObject(span: string): TrackPick | undefined {
    try {
        const value = JSON.parse(span) as { title?: unknown; artist?: unknown };
        const title = typeof value.title === 'string' ? value.title.trim() : '';
        const artist = typeof value.artist === 'string' ? value.artist.trim() : '';
        return title.length > 0 && artist.length > 0 ? { title, artist } : undefined;
    } catch {
        return undefined;
    }
}
