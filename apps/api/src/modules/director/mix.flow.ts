import type { MixBranch, MixFlow, MixNode } from '#modules/schedule/types/mix.types.js';
import { refinesGenre, sameTag } from './genre.match.js';

/**
 * A show's mix flow, evaluated: one record followed down the wires.
 *
 * Every node is a pure test on the one record and on what the show has counted so far, so the walk is a
 * function and not a stream: the resolver, the explain route and the simulation all call this one, and
 * none of them can disagree about where a record goes. The flow is assumed valid (`mixFlowProblems`
 * refused anything else at the save); a walk that meets a wire it cannot follow stops and lets the
 * record through, because a flow that cannot say no is a flow that has nothing to say.
 */

/** What the walk knows about one record. */
export interface MixRecord {
    title: string;
    artist: string;
    /** The band's main genre: the first genre its enrichment lists. Absent matches no genre. */
    mainGenre?: string;
    /** Its release year, for a split by decade. */
    year?: number;
    /** Moods a model has judged it to be in, for a split by mood. */
    moods?: readonly string[];
}

/** A record the show has already counted, with the nodes its own walk passed through. */
export interface CountedRecord extends MixRecord {
    /** The hour on the station's clock it aired in, or is about to. */
    hour: number;
    path: readonly string[];
}

/** What the show has done so far, as the walk needs it. */
export interface MixContext {
    /** The hour on the station's clock the record would air in. */
    hour: number;
    /** How far through the show it would air, as a percent from 0. */
    showProgress: number;
    /** What the flow counts: aired and queued records that were not requests, oldest first. */
    counted: readonly CountedRecord[];
}

/** Where a record went: the nodes it passed through, and the node that held it if one did. */
export interface MixWalk {
    path: string[];
    heldAt?: string;
}

/** A `require` node that has fallen due, and what would satisfy it now. */
export interface MixRequirement {
    nodeId: string;
    /** The genres still wanted: all of them for `any`, the ones not yet aired for `each`. */
    genres: string[];
    songs: { title: string; artist?: string }[];
}

/** What one limit or block allows now, for the model's prompt. */
export interface MixBudgetLine {
    nodeId: string;
    kind: 'limitShare' | 'limitCount' | 'block';
    /** What reaches it, as the splits on the way say: `main genre black metal`. Empty is every record. */
    reaching: string[];
    /** How many more may pass it now, in `per`. Absent for a block. */
    left?: number;
    per?: 'show' | 'hour';
    /** The bands a block keeps off. */
    bands?: string[];
}

class Wires {
    private readonly nodes = new Map<string, MixNode>();
    private readonly outs = new Map<string, string>();
    private readonly numberInto = new Map<string, string>();

    constructor(readonly flow: MixFlow) {
        for (const node of flow.nodes) this.nodes.set(node.id, node);
        for (const link of flow.links) {
            const to = this.nodes.get(link.to);
            if (to?.kind === 'limitShare' && link.in === 1) this.numberInto.set(link.to, link.from);
            else this.outs.set(`${link.from}:${link.out}`, link.to);
        }
    }

    node(id: string): MixNode | undefined {
        return this.nodes.get(id);
    }

    next(id: string, out = 0): MixNode | undefined {
        const to = this.outs.get(`${id}:${out}`);
        return to === undefined ? undefined : this.nodes.get(to);
    }

    picks(): MixNode | undefined {
        return this.flow.nodes.find(node => node.kind === 'picks');
    }

    /** A `limitShare`'s amount as a fraction: the number wired into it, else its own percent. */
    share(node: MixNode, hour: number): number | undefined {
        const source = this.numberInto.get(node.id);
        const fed = source === undefined ? undefined : this.nodes.get(source);
        if (fed?.kind === 'timeSwitch' && fed.fromHour !== undefined) {
            const value = hour >= fed.fromHour ? fed.thenValue : fed.elseValue;
            if (value !== undefined) return value / 100;
        }
        return node.percent === undefined ? undefined : node.percent / 100;
    }
}

/** Counted records in the limit's own scope: the whole show, or the hour the record would air in. */
const inScope = (counted: readonly CountedRecord[], per: 'show' | 'hour' | undefined, hour: number) =>
    per === 'hour' ? counted.filter(record => record.hour === hour) : counted;

/**
 * Which output of a split a record leaves by: the first branch it matches, else "everything else",
 * which is the output after the last branch.
 */
export function splitOutput(node: MixNode, record: MixRecord, ctx: MixContext): number {
    const branches = node.branches ?? [];
    const index = branches.findIndex(branch => matches(node, branch, record, ctx));
    return index < 0 ? branches.length : index;
}

function matches(node: MixNode, branch: MixBranch, record: MixRecord, ctx: MixContext): boolean {
    const values = branch.values ?? [];
    const genre = (value: string | undefined) => value !== undefined && values.some(wanted => refinesGenre(value, wanted));
    switch (node.splitBy) {
        case 'genre':
            return genre(record.mainGenre);
        case 'lastGenre':
            return genre(ctx.counted.at(-1)?.mainGenre);
        case 'artist':
            return values.some(wanted => sameTag(record.artist, wanted));
        case 'decade':
            return record.year !== undefined && values.some(wanted => Math.floor(record.year! / 10) * 10 === Number(wanted));
        case 'mood':
            return (record.moods ?? []).some(mood => values.includes(mood));
        case 'hour':
            return inRange(ctx.hour, branch);
        case 'showProgress':
            return inRange(ctx.showProgress, branch);
        case 'judged':
        case undefined:
            return false;
    }
}

/** `min` inclusive, `max` exclusive; a range whose `min` is past its `max` runs round midnight. */
function inRange(value: number, branch: MixBranch): boolean {
    const min = branch.min ?? 0;
    const max = branch.max ?? Number.POSITIVE_INFINITY;
    return min <= max ? value >= min && value < max : value >= min || value < max;
}

/**
 * Whether a node holds this record, given what the show has counted. The first of a group is always let
 * through, so 10% is a share and never a ban on a show that has aired nothing yet.
 */
function holds(wires: Wires, node: MixNode, record: MixRecord, ctx: MixContext): boolean {
    switch (node.kind) {
        case 'block': {
            const bands = node.bands ?? [];
            return bands.some(band => sameTag(record.artist, band));
        }
        case 'limitShare': {
            const share = wires.share(node, ctx.hour);
            if (share === undefined) return false;
            const scope = inScope(ctx.counted, node.per, ctx.hour);
            const through = scope.filter(counted => counted.path.includes(node.id)).length;
            return through > 0 && (through + 1) / (scope.length + 1) > share;
        }
        case 'limitCount': {
            if (node.count === undefined) return false;
            const through = inScope(ctx.counted, node.per, ctx.hour).filter(counted => counted.path.includes(node.id)).length;
            return through >= node.count;
        }
        case 'noRepeat':
            return ctx.counted.at(-1)?.path.includes(node.id) === true;
        default:
            return false;
    }
}

/**
 * Follow one record down the wires from `entry` (Picks, or the `require` node that added it).
 *
 * `holding: false` walks it without holding it anywhere, which is how a record that already aired is
 * given the path it took: it aired, so it is counted through every node on its way whatever the counts
 * would say now.
 */
export function walkRecord(flow: MixFlow, record: MixRecord, ctx: MixContext, options: { entry?: string; holding?: boolean } = {}): MixWalk {
    const wires = new Wires(flow);
    const path: string[] = [];
    let node = options.entry === undefined ? wires.picks() : wires.node(options.entry);
    // A valid flow has no circles; the bound is for one that somehow does.
    for (let step = 0; node !== undefined && step <= flow.nodes.length; step += 1) {
        path.push(node.id);
        if (node.kind === 'onAir') return { path };
        if (options.holding !== false && holds(wires, node, record, ctx)) return { path, heldAt: node.id };
        node = wires.next(node.id, node.kind === 'split' ? splitOutput(node, record, ctx) : 0);
    }
    return { path };
}

/**
 * Give each counted record, oldest first, the path its walk takes with what was counted before it.
 *
 * Read again from the flow rather than stored with each record, so a flow edited in the middle of a show
 * counts the show so far by its new wiring: a limit added at nine o'clock knows how much of its genre
 * the show has already aired.
 */
export function countThrough(flow: MixFlow, records: readonly (MixRecord & { hour: number })[]): CountedRecord[] {
    const counted: CountedRecord[] = [];
    for (const record of records) {
        const { path } = walkRecord(flow, record, { hour: record.hour, showProgress: 0, counted }, { holding: false });
        counted.push({ ...record, path });
    }
    return counted;
}

/** The `require` nodes that are due now, with what would still satisfy each. */
export function dueRequirements(flow: MixFlow, ctx: MixContext): MixRequirement[] {
    return flow.nodes.flatMap(node => {
        if (node.kind !== 'require') return [];
        if (ctx.showProgress < (node.afterPercent ?? 0)) return [];
        const songs = (node.songs ?? []).map(song => ({ title: song.title, ...(song.artist === undefined ? {} : { artist: song.artist }) }));
        const wanted = node.requireGenres ?? [];
        const aired = (genre: string) => ctx.counted.some(record => record.mainGenre !== undefined && refinesGenre(record.mainGenre, genre));
        // With no genre named, the songs themselves are what it requires: due until one of them has aired.
        if (wanted.length === 0) {
            const played = ctx.counted.some(record => songs.some(song => sameTag(record.title, song.title)));
            return played ? [] : [{ nodeId: node.id, genres: [], songs }];
        }
        const genres = node.requireMode === 'each' ? wanted.filter(genre => !aired(genre)) : wanted.some(aired) ? [] : wanted;
        return genres.length === 0 ? [] : [{ nodeId: node.id, genres, songs }];
    });
}

/**
 * What each limit and block allows now, for the model to be told: so it stops proposing records the
 * resolver would hold, and the rules hold few.
 */
export function budgetLeft(flow: MixFlow, ctx: MixContext): MixBudgetLine[] {
    const wires = new Wires(flow);
    return flow.nodes.flatMap((node): MixBudgetLine[] => {
        const reaching = reachingDescription(wires, node.id);
        if (node.kind === 'block') return [{ nodeId: node.id, kind: 'block', reaching, bands: [...(node.bands ?? [])] }];
        if (node.kind !== 'limitShare' && node.kind !== 'limitCount') return [];
        const per = node.per ?? 'show';
        const scope = inScope(ctx.counted, per, ctx.hour);
        const through = scope.filter(counted => counted.path.includes(node.id)).length;
        let left: number;
        if (node.kind === 'limitCount') left = Math.max(0, (node.count ?? 0) - through);
        else {
            const share = wires.share(node, ctx.hour) ?? 1;
            // The most k with (through + k) / (total + k) <= share, and always one for a group not yet heard.
            left =
                through === 0 ? 1 : share >= 1 ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor((share * scope.length - through) / (1 - share)));
        }
        return [{ nodeId: node.id, kind: node.kind, reaching, left, per }];
    });
}

/** The split branches on the way from Picks to a node, as words: the first path found. */
function reachingDescription(wires: Wires, target: string): string[] {
    const start = wires.picks();
    if (start === undefined) return [];
    const seen = new Set<string>();
    const search = (node: MixNode, said: string[]): string[] | undefined => {
        if (node.id === target) return said;
        if (seen.has(node.id)) return undefined;
        seen.add(node.id);
        const outs = node.kind === 'split' ? (node.branches?.length ?? 0) + 1 : 1;
        for (let out = 0; out < outs; out += 1) {
            const next = wires.next(node.id, out);
            if (next === undefined) continue;
            const branch = node.kind === 'split' ? node.branches?.[out] : undefined;
            const words =
                node.kind !== 'split'
                    ? said
                    : branch === undefined
                      ? [...said, `not ${describeSplit(node)}`]
                      : [...said, describeBranch(node, branch)];
            const found = search(next, words);
            if (found !== undefined) return found;
        }
        return undefined;
    };
    return search(start, []) ?? [];
}

const SPLIT_WORDS: Record<Exclude<NonNullable<MixNode['splitBy']>, 'judged'>, string> = {
    genre: 'main genre',
    artist: 'artist',
    decade: 'decade',
    mood: 'mood',
    hour: 'hour',
    showProgress: 'percent of the show',
    lastGenre: 'after a record of main genre',
};

function describeSplit(node: MixNode): string {
    const branches = (node.branches ?? []).map(branch => describeBranch(node, branch));
    return branches.length === 0 ? 'any branch' : branches.join(' or ');
}

function describeBranch(node: MixNode, branch: MixBranch): string {
    if (node.splitBy === undefined) return 'split';
    if (node.splitBy === 'judged') return `${node.question ?? 'judged'}: ${(branch.values ?? []).join(' or ')}`;
    const words = SPLIT_WORDS[node.splitBy];
    if (branch.values !== undefined && branch.values.length > 0) return `${words} ${branch.values.join(' or ')}`;
    return `${words} ${branch.min ?? 0} to ${branch.max ?? 'end'}`;
}

/** A show's flow and what it has counted so far, as the picker is handed them. */
export interface MixInForce {
    flow: MixFlow;
    ctx: MixContext;
}

/**
 * A batch, in the order it will air, without the records the flow holds.
 *
 * Each kept record is counted before the next is judged, so a batch cannot take a share twice over
 * by bringing three black metal records in at once. A held record is simply not in the batch: the
 * running order asks again when it runs short, and the next ask is told the budget.
 *
 * Fails open in one case, the station's rule for a gate that cannot answer: when the flow would hold
 * EVERY record in a batch that had some, the ones a limit held (never a block) are let back so the show
 * is not starved into silence by its own amounts. `gaveWay` says so for the caller's log.
 */
export function holdMixFlow<T extends MixRecord>(
    records: readonly T[],
    mix: MixInForce,
): { kept: T[]; held: { record: T; at: string }[]; gaveWay: boolean } {
    const counted = [...mix.ctx.counted];
    const kept: T[] = [];
    const held: { record: T; at: string }[] = [];
    for (const record of records) {
        const walk = walkRecord(mix.flow, record, { ...mix.ctx, counted });
        if (walk.heldAt === undefined) {
            kept.push(record);
            counted.push({ ...record, hour: mix.ctx.hour, path: walk.path });
        } else held.push({ record, at: walk.heldAt });
    }
    if (kept.length > 0 || held.length === 0) return { kept, held, gaveWay: false };

    const wires = new Wires(mix.flow);
    const limited = held.filter(entry => wires.node(entry.at)?.kind !== 'block');
    return limited.length === 0
        ? { kept, held, gaveWay: false }
        : { kept: limited.map(entry => entry.record), held: held.filter(entry => !limited.includes(entry)), gaveWay: true };
}

/**
 * The flow's limits and blocks as lines for the model's prompt: what it may still choose and what it
 * may not. Stated as what will HAPPEN, the way the per-artist cap is, because the resolver holds these
 * whatever the model does, and a model that knows the arithmetic stops spending picks on records the
 * rules then drop.
 */
export function mixBudgetSentences(lines: readonly MixBudgetLine[]): string[] {
    return lines.flatMap(line => {
        const which = line.reaching.length === 0 ? '' : ` (${line.reaching.join(', ')})`;
        if (line.kind === 'block') {
            const bands = line.bands ?? [];
            if (bands.length === 0) return [];
            return [
                `- Never ${bands.join(', ')}${line.reaching.length === 0 ? '' : ` among records${which}`}. Name one and it is dropped and something else plays.`,
            ];
        }
        if (line.left === undefined || !Number.isFinite(line.left)) return [];
        const per = line.per === 'hour' ? 'this hour' : 'in this show';
        if (line.left === 0) return [`- No more records${which} ${per}. Any you name are dropped and something else plays.`];
        return [`- At most ${line.left} more ${line.left === 1 ? 'record' : 'records'}${which} ${per}. Name more and the extra ones are dropped.`];
    });
}
