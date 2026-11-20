import { createHash } from 'node:crypto';
import type { MixBranch, MixFlow, MixNode } from '#modules/schedule/types/mix.types.js';
import { refinesGenre, sameTag } from './genre.match.js';

/**
 * A show's mix flow, evaluated: one record followed down the wires.
 *
 * Every node is a pure test on the one record and on what the show has counted so far, so the walk is a
 * function and not a stream: the resolver, the shortlist and the flow's counts all call this one, and
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
    /**
     * Its measured energy as a third of the station's LIBRARY, for a split by energy. The library and not
     * the batch, because a split is a rule the counts replay: a record has to go down the same branch
     * every time the show's history is walked, and a third of whatever the batch held would move it.
     * Absent for a record not measured yet, which matches no energy branch.
     */
    energy?: 'low' | 'medium' | 'high';
    /**
     * The model's stored answers about this record, by question key (`judgeKey`), for a split by
     * `judged`. A question with no answer yet holds the record at that split.
     */
    judged?: ReadonlyMap<string, boolean>;
}

/** A judge question as the key its answers are stored under: the same question asked by two shows shares them. */
export function judgeKey(question: string): string {
    return createHash('sha256').update(question.trim().toLowerCase().replace(/\s+/g, ' ')).digest('hex').slice(0, 24);
}

/** The questions a flow's judge splits ask, each once, with the key their answers are stored under. */
export function judgeQuestions(flow: MixFlow): { key: string; question: string }[] {
    const questions = new Map<string, string>();
    for (const node of flow.nodes) {
        if (node.kind === 'split' && node.splitBy === 'judged' && node.question !== undefined && node.bypassed !== true)
            questions.set(judgeKey(node.question), node.question);
    }
    return [...questions].map(([key, question]) => ({ key, question }));
}

/** The stored answer to a judged split's question about a record, or `undefined` while it is pending. */
export function judgedAnswer(node: MixNode, record: MixRecord): boolean | undefined {
    return node.question === undefined ? undefined : record.judged?.get(judgeKey(node.question));
}

/** A record the show has already counted, with the nodes its own walk passed through. */
export interface CountedRecord extends MixRecord {
    /** The hour on the station's clock it aired in, or is about to. */
    hour: number;
    /** How far through the show it aired, or is about to, as a percent. Absent reads as the start. */
    progress?: number;
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
        if (fed?.kind === 'timeSwitch' && fed.bypassed !== true && fed.fromHour !== undefined) {
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
    // Bypassed: every record goes the way a record matching nothing would.
    if (node.bypassed === true) return branches.length;
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
        case 'energy':
            return record.energy !== undefined && values.includes(record.energy);
        case 'hour':
            return inRange(ctx.hour, branch);
        case 'showProgress':
            return inRange(ctx.showProgress, branch);
        case 'judged': {
            const answer = judgedAnswer(node, record);
            return answer !== undefined && values.includes(answer ? 'yes' : 'no');
        }
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
    // Switched off: it holds nothing, whatever it is.
    if (node.bypassed === true) return false;
    switch (node.kind) {
        // A question the model has not answered about this record yet: never aired on a guess. The record
        // waits a refill while `MixJudgeJob` asks, the same spirit as a band with no genre matching none.
        case 'split':
            return node.splitBy === 'judged' && judgedAnswer(node, record) === undefined;
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
export function walkRecord(
    flow: MixFlow,
    record: MixRecord,
    ctx: MixContext,
    options: { entry?: string; holding?: boolean; blocksOnly?: boolean } = {},
): MixWalk {
    const wires = new Wires(flow);
    const path: string[] = [];
    let node = options.entry === undefined ? wires.picks() : wires.node(options.entry);
    // A valid flow has no circles; the bound is for one that somehow does.
    for (let step = 0; node !== undefined && step <= flow.nodes.length; step += 1) {
        // A bypassed node is passed through and left off the path while it stays bypassed. The counts are
        // a replay through the flow as it now stands, so once it is switched back on the records that
        // aired while it was off are counted through it again, as for any mid-show edit.
        if (node.bypassed !== true) path.push(node.id);
        if (node.kind === 'onAir') return { path };
        // `blocksOnly` is giving way: only a Block holds. See `holdMixFlow`.
        const counts = options.blocksOnly !== true || node.kind === 'block';
        if (options.holding !== false && counts && holds(wires, node, record, ctx)) return { path, heldAt: node.id };
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
export function countThrough(flow: MixFlow, records: readonly (MixRecord & { hour: number; progress?: number })[]): CountedRecord[] {
    const counted: CountedRecord[] = [];
    for (const record of records) {
        // In its own hour and at its own point in the show, so a split by hour or by progress counts it
        // where it aired rather than where the show is now.
        const { path } = walkRecord(flow, record, { hour: record.hour, showProgress: record.progress ?? 0, counted }, { holding: false });
        counted.push({ ...record, path });
    }
    return counted;
}

/** The `require` nodes that are due now, with what would still satisfy each. */
export function dueRequirements(flow: MixFlow, ctx: MixContext): MixRequirement[] {
    return flow.nodes.flatMap(node => {
        if (node.kind !== 'require' || node.bypassed === true) return [];
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
        // Switched off: nothing to tell the model, since it holds nothing.
        if (node.bypassed === true) return [];
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
        const branchCount = node.branches?.length ?? 0;
        // A bypassed split sends everything down "everything else", and says nothing about what it reads.
        const bypassedSplit = node.kind === 'split' && node.bypassed === true;
        const outs = node.kind === 'split' && !bypassedSplit ? branchCount + 1 : 1;
        for (let index = 0; index < outs; index += 1) {
            const out = bypassedSplit ? branchCount : index;
            const next = wires.next(node.id, out);
            if (next === undefined) continue;
            const branch = node.kind === 'split' ? node.branches?.[out] : undefined;
            const words =
                node.kind !== 'split' || bypassedSplit
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
    hour: 'hour',
    showProgress: 'percent of the show',
    lastGenre: 'after a record of main genre',
    energy: 'energy',
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
export function holdMixFlow<T extends MixRecord & { mixEntry?: string }>(
    records: readonly T[],
    mix: MixInForce,
): { kept: T[]; held: { record: T; at: string }[]; gaveWay: boolean } {
    const counted = [...mix.ctx.counted];
    const kept: T[] = [];
    const held: { record: T; at: string }[] = [];
    for (const record of records) {
        // A required record is walked from the `require` node that asked for it. See `TrackPick.mixEntry`.
        const walk = walkRecord(mix.flow, record, { ...mix.ctx, counted }, record.mixEntry === undefined ? {} : { entry: record.mixEntry });
        if (walk.heldAt === undefined) {
            kept.push(record);
            counted.push({ ...record, hour: mix.ctx.hour, progress: mix.ctx.showProgress, path: walk.path });
        } else held.push({ record, at: walk.heldAt });
    }
    if (kept.length > 0 || held.length === 0) return { kept, held, gaveWay: false };

    // Giving way, in two steps. A record is given back only if it reaches On air with the limits lifted,
    // so a Block anywhere on its path still holds it, wherever it sits. A record waiting for the judge's
    // answer is given back only when lifting the limits alone gives back nothing, because a judge exists
    // to keep records off until it has answered.
    const blocksOnly = (record: T) =>
        walkRecord(mix.flow, record, mix.ctx, { blocksOnly: true, ...(record.mixEntry === undefined ? {} : { entry: record.mixEntry }) }).heldAt ===
        undefined;
    for (const judgeHolds of [true, false]) {
        const back = held.filter(entry => (judgeHolds ? reachesPastLimits(mix.flow, entry.record, mix.ctx) : blocksOnly(entry.record)));
        if (back.length > 0) return { kept: back.map(entry => entry.record), held: held.filter(entry => !back.includes(entry)), gaveWay: true };
    }
    return { kept, held, gaveWay: false };
}

/** Whether a record reaches On air with every limit lifted, still held by blocks and by a pending judge. */
function reachesPastLimits(flow: MixFlow, record: MixRecord & { mixEntry?: string }, ctx: MixContext): boolean {
    const wires = new Wires(flow);
    let node = record.mixEntry === undefined ? wires.picks() : wires.node(record.mixEntry);
    for (let step = 0; node !== undefined && step <= flow.nodes.length; step += 1) {
        if (node.kind === 'onAir') return true;
        const limit = node.kind === 'limitShare' || node.kind === 'limitCount' || node.kind === 'noRepeat';
        if (!limit && holds(wires, node, record, ctx)) return false;
        node = wires.next(node.id, node.kind === 'split' ? splitOutput(node, record, ctx) : 0);
    }
    return true;
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
