import type { LlmMessage } from '@deadair/plugin-sdk';
import { firstJsonObject } from '#modules/shared/json.objects.js';
import type { MixDraftAnswer, MixDraftReading, MixFlow, MixLink, MixNode } from '#modules/schedule/types/mix.types.js';

/**
 * Drafting a show's mix flow from its brief: the prompt, the reading of the model's answer, and the
 * flow built from it. Pure; the call is `MixDraftService`.
 *
 * The model is asked for RULES, not for a graph. It is good at reading "black metal only now and then"
 * as a tenth of an hour and bad at numbering sockets, and a wiring mistake is the kind of error a save
 * refuses. So it says what each phrase means, and the station lays the rules out as nodes and wires
 * itself, in one shape every time: Picks, then a Block per band list, then a split per limited group
 * whose matching branch runs through its limit to a Merge and whose "everything else" runs on to the
 * next, then On air. Required records enter at the Merge, so the limits never hold a promised record.
 */

/** A group of records a rule is about: main genres, a question for the model, or both. */
interface Match {
    genres: string[];
    question?: string;
}

export type DraftRule =
    | { kind: 'block'; bands: string[]; quote: string; note: string }
    | {
          kind: 'limit';
          match: Match;
          percent?: number;
          count?: number;
          per: 'show' | 'hour';
          later?: { fromHour: number; percent: number };
          /** When the match has a genre and a question, what becomes of the genre's records the model says no to. */
          others: 'hold' | 'pass';
          quote: string;
          note: string;
      }
    | {
          kind: 'require';
          genres: string[];
          songs: { title: string; artist: string }[];
          mode: 'any' | 'each';
          afterPercent: number;
          quote: string;
          note: string;
      }
    | { kind: 'noRepeat'; genres: string[]; quote: string; note: string };

export interface ReadDraft {
    rules: DraftRule[];
    /** Phrases read and left to the picks, or that could not become a rule, with why. */
    readings: MixDraftReading[];
}

const SYSTEM = [
    "You turn a radio show's brief into the rules a station enforces on every record it picks for the show.",
    'Only amounts, bans and promises become rules. Taste and mood ("dark", "slow-burning", "deep cuts") stay with the picks: list those phrases as taste.',
    '',
    'The rules you can use:',
    '- block: bands that never play. {"kind": "block", "bands": ["Burzum"]}',
    '- limit: a group held to a share or a number, per hour or per show. A share is "percent"; a number is "count". "Now and then" is about 10 percent; "rare" or "a single" is a count.',
    '  {"kind": "limit", "genres": ["black metal"], "percent": 10, "per": "hour"}',
    '  A share can change at an hour on the station clock: add "later": {"fromHour": 22, "percent": 30}.',
    '  When main genre cannot say which records are meant (a "sinful" pop hit, a "classic"), add "question": a yes-or-no question the station asks a model about each record, once. With genres and a question, "others" says what happens to the genre\'s records the model says no to: "hold" keeps them off, "pass" lets them play.',
    '  {"kind": "limit", "genres": ["pop"], "question": "Is this a famous, sinful pop hit?", "count": 1, "per": "show", "others": "hold"}',
    '- require: a record the show promises, added once enough of it has gone. Name main genres, or records by title and artist, or both. "mode" is "any" (one record of any of the genres) or "each" (one of each).',
    '  {"kind": "require", "genres": ["gospel"], "songs": [{"title": "Oh Happy Day", "artist": "Edwin Hawkins Singers"}], "mode": "any", "afterPercent": 40}',
    '- noRepeat: never two records of these genres back to back. {"kind": "noRepeat", "genres": ["black metal"]}',
    '',
    'A record\'s genre is its band\'s MAIN genre, lower case, and a genre takes everything that refines it: "black metal" also takes "norwegian black metal". Use the names the station\'s library uses where one fits.',
    '"Rare", "now and then" and "a little" are limits: they cap a group and promise nothing. Only "always", "every show" or "make sure" promise a record.',
    'Records the brief names as examples belong in the rule they illustrate: as "songs" in a require, or as the reason for a judge question.',
    'Give every rule "quote", the words of the brief it came from, and "note", what it does in a few plain words.',
    'When a phrase could mean two different rules, make your best guess, and also ask the operator about the brief: quote the phrase, ask which it meant, and give two to four short options that are each a different rule ("at most one a show", "one every show").',
    '',
    'Answer with one JSON object and nothing else:',
    '{"rules": [...], "taste": [{"quote": "...", "note": "..."}], "questions": [{"quote": "...", "question": "...", "options": ["...", "..."]}]}',
].join('\n');

/**
 * The conversation that drafts a flow. `genres` is the library's commonest main genres with how many
 * bands have each, so the model names a genre the station can match; `answers` settles what an earlier
 * draft of the same brief asked.
 */
export function mixDraftPrompt(
    brief: string,
    genres: readonly { genre: string; bands: number }[],
    answers: readonly MixDraftAnswer[] = [],
): LlmMessage[] {
    const lines = ['The brief:', brief.trim()];
    if (genres.length > 0) {
        lines.push('', "The commonest main genres in the station's library, with how many bands have each:");
        lines.push(genres.map(entry => `${entry.genre} (${entry.bands})`).join(', '));
    }
    if (answers.length > 0) {
        lines.push('', 'The operator has answered what an earlier draft asked. Follow these and do not ask them again:');
        for (const answer of answers) lines.push(`- ${answer.question} ${answer.answer}`);
    }
    return [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: lines.join('\n') },
    ];
}

/** The rules the model's answer names, each checked and trimmed to what a flow can hold, or `undefined` for an answer that names none. */
export function readMixDraft(answer: string): ReadDraft | undefined {
    const parsed = firstJsonObject(answer);
    if (parsed === undefined || !Array.isArray(parsed.rules)) return undefined;

    const rules: DraftRule[] = [];
    const readings: MixDraftReading[] = [];
    for (const raw of parsed.rules) {
        if (!isRecord(raw)) continue;
        const quote = text(raw.quote, 200) ?? '';
        const note = text(raw.note, 300) ?? '';
        const rule = ruleOf(raw, quote, note);
        if (typeof rule === 'string') readings.push({ quote, note: rule });
        else rules.push(rule);
    }

    for (const raw of Array.isArray(parsed.taste) ? parsed.taste : []) {
        if (!isRecord(raw)) continue;
        const quote = text(raw.quote, 200);
        if (quote !== undefined) readings.push({ quote, note: text(raw.note, 300) ?? 'Left to the picks.' });
    }

    for (const raw of Array.isArray(parsed.questions) ? parsed.questions : []) {
        if (!isRecord(raw)) continue;
        const question = text(raw.question, 300);
        if (question === undefined) continue;
        const options = strings(raw.options, 6, 200);
        readings.push({
            quote: text(raw.quote, 200) ?? '',
            note: 'Unclear, so the draft made its best guess.',
            question,
            ...(options.length > 0 ? { options } : {}),
        });
    }

    if (rules.length === 0 && readings.length === 0) return undefined;
    return { rules, readings };
}

/** One rule from the model's answer, or why it could not be one. */
function ruleOf(raw: Record<string, unknown>, quote: string, note: string): DraftRule | string {
    switch (raw.kind) {
        case 'block': {
            const bands = strings(raw.bands, 50, 200);
            return bands.length === 0 ? 'Read as a ban, but it named no band.' : { kind: 'block', bands, quote, note };
        }
        case 'limit': {
            const genres = genresOf(raw.genres, 20);
            const question = text(raw.question, 200);
            if (genres.length === 0 && question === undefined) return 'Read as a limit, but it named no genre and asked nothing.';
            const per = raw.per === 'hour' ? 'hour' : 'show';
            const percent = numberIn(raw.percent, 0, 100);
            const count = numberIn(raw.count, 0, 1000);
            if (percent === undefined && count === undefined) return 'Read as a limit, but it gave no amount.';
            const laterRaw = isRecord(raw.later) ? raw.later : undefined;
            const fromHour = numberIn(laterRaw?.fromHour, 0, 23);
            const laterPercent = numberIn(laterRaw?.percent, 0, 100);
            const later =
                percent !== undefined && fromHour !== undefined && laterPercent !== undefined
                    ? { fromHour: Math.floor(fromHour), percent: laterPercent }
                    : undefined;
            return {
                kind: 'limit',
                match: { genres, ...(question === undefined ? {} : { question }) },
                ...(percent !== undefined ? { percent } : { count: Math.floor(count!) }),
                per,
                ...(later === undefined ? {} : { later }),
                others: raw.others === 'hold' ? 'hold' : 'pass',
                quote,
                note,
            };
        }
        case 'require': {
            const genres = genresOf(raw.genres, 4);
            const songs = (Array.isArray(raw.songs) ? raw.songs : [])
                .flatMap(song => {
                    if (!isRecord(song)) return [];
                    const title = text(song.title, 500);
                    const artist = text(song.artist, 500);
                    return title === undefined || artist === undefined ? [] : [{ title, artist }];
                })
                .slice(0, 20);
            if (genres.length === 0 && songs.length === 0) return 'Read as a promise, but it named no genre and no record.';
            return {
                kind: 'require',
                genres,
                songs,
                mode: raw.mode === 'each' ? 'each' : 'any',
                afterPercent: numberIn(raw.afterPercent, 0, 100) ?? 0,
                quote,
                note,
            };
        }
        case 'noRepeat': {
            const genres = genresOf(raw.genres, 20);
            return genres.length === 0 ? 'Read as "never two in a row", but it named no genre.' : { kind: 'noRepeat', genres, quote, note };
        }
        default:
            return 'Not a rule the station has.';
    }
}

const SPINE_Y = 160;
const STEP_X = 320;
const LANE_Y = SPINE_Y + 340;
const REQUIRE_Y = SPINE_Y - 380;

/**
 * The flow the rules make, laid out left to right, and which nodes each phrase became.
 *
 * Always one that passes `mixFlowProblems`: every split's branch and "everything else" leads on, every
 * limit leads to the Merge, and nothing feeds back. With no rules it is Picks wired to On air, which
 * plays exactly as a show with no flow.
 */
export function buildMixDraft(draft: ReadDraft): { flow: MixFlow; readings: MixDraftReading[] } {
    const nodes: MixNode[] = [];
    const links: MixLink[] = [];
    const readings: MixDraftReading[] = [];
    const used = new Map<string, number>();
    const id = (kind: string) => {
        const next = (used.get(kind) ?? 0) + 1;
        used.set(kind, next);
        return `${kind}-${next}`;
    };
    const wire = (from: string, to: string, out = 0, into = 0) => links.push({ from, out, to, in: into });
    const fromBrief = (quote: string) => (quote.length === 0 ? {} : { fromBrief: quote.slice(0, 200) });

    nodes.push({ id: 'picks', kind: 'picks', x: 0, y: SPINE_Y });
    let x = STEP_X;
    /** The output records leave by on the spine, waiting for the next node. */
    let tail = { node: 'picks', out: 0 };

    for (const rule of draft.rules) {
        if (rule.kind !== 'block') continue;
        const block = id('block');
        nodes.push({ id: block, kind: 'block', bands: rule.bands, ...fromBrief(rule.quote), x, y: SPINE_Y });
        wire(tail.node, block, tail.out);
        tail = { node: block, out: 0 };
        x += STEP_X;
        readings.push({ quote: rule.quote, note: rule.note || `Never plays ${rule.bands.join(', ')}.`, nodeIds: [block] });
    }

    const lanes = draft.rules.filter(rule => rule.kind === 'limit');
    const repeats = draft.rules.filter(rule => rule.kind === 'noRepeat');
    const requires = draft.rules.filter(rule => rule.kind === 'require');
    /** A "never two in a row" whose genres are a limit's rides that limit's lane; the rest get a lane of their own. */
    const riding = new Map<DraftRule, DraftRule & { kind: 'noRepeat' }>();
    for (const repeat of repeats) {
        const lane = lanes.find(limit => limit.match.question === undefined && sameGenres(limit.match.genres, repeat.genres) && !riding.has(limit));
        if (lane !== undefined) riding.set(lane, repeat);
    }
    const ownLanes = repeats.filter(repeat => ![...riding.values()].includes(repeat));

    if (lanes.length + ownLanes.length + requires.length === 0) {
        nodes.push({ id: 'air', kind: 'onAir', x, y: SPINE_Y });
        wire(tail.node, 'air', tail.out);
        return { flow: { version: 1, nodes, links }, readings: [...readings, ...draft.readings] };
    }

    const merge = 'merge-1';
    used.set('merge', 1);
    /** Wires into the Merge, drawn once its place is known. */
    const intoMerge: { from: string; out: number; into: number }[] = [];

    const lane = (rule: DraftRule & { kind: 'limit' | 'noRepeat' }) => {
        const drawn: string[] = [];
        const genres = rule.kind === 'limit' ? rule.match.genres : rule.genres;
        const question = rule.kind === 'limit' ? rule.match.question : undefined;
        let entry: { node: string; out: number } | undefined;

        if (genres.length > 0) {
            const split = id('split');
            nodes.push({ id: split, kind: 'split', splitBy: 'genre', branches: [{ values: genres }], ...fromBrief(rule.quote), x, y: SPINE_Y });
            wire(tail.node, split, tail.out);
            drawn.push(split);
            entry = { node: split, out: 0 };
            tail = { node: split, out: 1 };
        }
        if (question !== undefined) {
            const judge = id('split');
            const judgeX = x;
            const judgeY = entry === undefined ? SPINE_Y : LANE_Y;
            nodes.push({
                id: judge,
                kind: 'split',
                splitBy: 'judged',
                question,
                branches: [{ values: ['yes'] }],
                ...fromBrief(rule.quote),
                x: judgeX,
                y: judgeY,
            });
            if (entry === undefined) {
                wire(tail.node, judge, tail.out);
                tail = { node: judge, out: 1 };
            } else {
                wire(entry.node, judge, entry.out);
                if (rule.kind === 'limit' && rule.others === 'hold') {
                    const none = id('limitCount');
                    nodes.push({
                        id: none,
                        kind: 'limitCount',
                        count: 0,
                        per: 'show',
                        ...fromBrief(rule.quote),
                        x: judgeX + STEP_X,
                        y: judgeY + 300,
                    });
                    wire(judge, none, 1);
                    intoMerge.push({ from: none, out: 0, into: 1 });
                    drawn.push(none);
                } else {
                    intoMerge.push({ from: judge, out: 1, into: 1 });
                }
            }
            drawn.push(judge);
            entry = { node: judge, out: 0 };
        }

        let at = { node: entry!.node, out: entry!.out };
        let laneX = x + STEP_X;
        const laneY = question !== undefined && genres.length > 0 ? LANE_Y : LANE_Y - 40;
        if (rule.kind === 'limit') {
            const limit = id(rule.percent !== undefined ? 'limitShare' : 'limitCount');
            nodes.push(
                rule.percent !== undefined
                    ? { id: limit, kind: 'limitShare', percent: rule.percent, per: rule.per, ...fromBrief(rule.quote), x: laneX, y: laneY }
                    : { id: limit, kind: 'limitCount', count: rule.count ?? 0, per: rule.per, ...fromBrief(rule.quote), x: laneX, y: laneY },
            );
            wire(at.node, limit, at.out);
            drawn.push(limit);
            if (rule.later !== undefined) {
                const clock = id('timeSwitch');
                nodes.push({
                    id: clock,
                    kind: 'timeSwitch',
                    fromHour: rule.later.fromHour,
                    thenValue: rule.later.percent,
                    elseValue: rule.percent ?? 0,
                    ...fromBrief(rule.quote),
                    x: laneX - STEP_X,
                    y: laneY + 300,
                });
                wire(clock, limit, 0, 1);
                drawn.push(clock);
            }
            at = { node: limit, out: 0 };
            laneX += STEP_X;
        }
        const repeat = rule.kind === 'noRepeat' ? rule : riding.get(rule);
        if (repeat !== undefined) {
            const guard = id('noRepeat');
            nodes.push({ id: guard, kind: 'noRepeat', ...fromBrief(repeat.quote), x: laneX, y: laneY });
            wire(at.node, guard, at.out);
            at = { node: guard, out: 0 };
            if (repeat !== rule) readings.push({ quote: repeat.quote, note: repeat.note || 'Never two in a row.', nodeIds: [guard] });
            drawn.push(guard);
        }
        intoMerge.push({ from: at.node, out: at.out, into: 1 });
        readings.push({ quote: rule.quote, note: rule.note || describe(rule), nodeIds: drawn });
        x += STEP_X * (question !== undefined && genres.length > 0 ? 3 : 2);
    };

    for (const rule of lanes) lane(rule);
    for (const rule of ownLanes) lane(rule);

    nodes.push({ id: merge, kind: 'merge', x, y: SPINE_Y });
    wire(tail.node, merge, tail.out, 0);
    for (const into of intoMerge) wire(into.from, merge, into.out, into.into);

    requires.forEach((rule, index) => {
        const require = id('require');
        nodes.push({
            id: require,
            kind: 'require',
            requireGenres: rule.genres,
            requireMode: rule.mode,
            ...(rule.songs.length === 0 ? {} : { songs: rule.songs }),
            afterPercent: rule.afterPercent,
            ...fromBrief(rule.quote),
            x: x - STEP_X * (requires.length - index),
            y: REQUIRE_Y,
        });
        wire(require, merge, 0, 2);
        readings.push({ quote: rule.quote, note: rule.note || 'A promised record.', nodeIds: [require] });
    });

    nodes.push({ id: 'air', kind: 'onAir', x: x + STEP_X, y: SPINE_Y });
    wire(merge, 'air');

    return { flow: { version: 1, nodes, links }, readings: [...readings, ...draft.readings] };
}

function describe(rule: DraftRule & { kind: 'limit' | 'noRepeat' }): string {
    if (rule.kind === 'noRepeat') return 'Never two in a row.';
    const amount = rule.percent !== undefined ? `${rule.percent}%` : `${rule.count}`;
    return `At most ${amount} a${rule.per === 'hour' ? 'n hour' : ' show'}.`;
}

function sameGenres(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every(genre => b.includes(genre));
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed.slice(0, max);
}

function strings(value: unknown, most: number, max: number): string[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of value) {
        const entry = text(item, max);
        if (entry === undefined || seen.has(entry.toLowerCase())) continue;
        seen.add(entry.toLowerCase());
        out.push(entry);
        if (out.length === most) break;
    }
    return out;
}

/** Genres as a branch matches them: lower case, each once. */
function genresOf(value: unknown, most: number): string[] {
    return strings(value, most, 100).map(genre => genre.toLowerCase());
}

function numberIn(value: unknown, min: number, max: number): number | undefined {
    const number = typeof value === 'string' ? Number(value) : value;
    if (typeof number !== 'number' || !Number.isFinite(number)) return undefined;
    return Math.min(max, Math.max(min, number));
}
