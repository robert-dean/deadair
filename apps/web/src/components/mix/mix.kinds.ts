import type { MixFlow, MixLink, MixNode } from '@deadair/sdk';

/**
 * A show's mix flow as the canvas edits it: which sockets each kind of node has, what a new node starts
 * with, and the client's own reading of what would stop it running.
 *
 * The station is the authority on whether a flow can run (`mixFlowProblems` in the API refuses a save
 * with every reason), and these checks exist so the canvas can mark a loose wire on the node while it is
 * being drawn instead of after a round trip. They are the same rules, kept short, and a disagreement
 * costs nothing worse than the save's own refusal.
 */

export type MixKind = MixNode['kind'];
export type SocketType = 'records' | 'number';

/** The kinds an operator adds from the palette, in the order it shows them. Picks and On air are always there. */
export const PALETTE_KINDS = [
    'block',
    'split',
    'limitShare',
    'limitCount',
    'noRepeat',
    'merge',
    'require',
    'timeSwitch',
] as const satisfies readonly MixKind[];

/** The sockets a node has, by number. The API's `socketsOf`, which the wire format numbers them by. */
export function socketsOf(node: Pick<MixNode, 'kind' | 'branches'>): { ins: SocketType[]; outs: SocketType[] } {
    switch (node.kind) {
        case 'picks':
        case 'require':
            return { ins: [], outs: ['records'] };
        case 'onAir':
            return { ins: ['records'], outs: [] };
        case 'split':
            return { ins: ['records'], outs: Array.from({ length: (node.branches?.length ?? 0) + 1 }, () => 'records' as const) };
        case 'limitShare':
            return { ins: ['records', 'number'], outs: ['records'] };
        case 'merge':
            return { ins: ['records', 'records', 'records', 'records'], outs: ['records'] };
        case 'timeSwitch':
            return { ins: [], outs: ['number'] };
        case 'block':
        case 'limitCount':
        case 'noRepeat':
            return { ins: ['records'], outs: ['records'] };
    }
}

/**
 * The rules that can be added at the loose end of a wire, and which of their sockets it meets.
 *
 * A wire dragged from an output into empty space wants a rule with an INPUT of the same type; one
 * dragged back from an input wants a rule with an OUTPUT of it. A rule with no such socket is not
 * offered, since adding it could not finish the wire.
 */
export function kindsAt(
    end: { side: 'source' | 'target'; type: SocketType } | undefined,
): { kind: (typeof PALETTE_KINDS)[number]; socket: number }[] {
    return PALETTE_KINDS.flatMap(kind => {
        if (end === undefined) return [{ kind, socket: 0 }];
        const { ins, outs } = socketsOf(freshNode(kind, kind, { x: 0, y: 0 }));
        const socket = (end.side === 'source' ? ins : outs).indexOf(end.type);
        return socket < 0 ? [] : [{ kind, socket }];
    });
}

/** What a node of a kind starts with when it is added, so a fresh node is one setting away from running. */
export function freshNode(kind: MixKind, id: string, position: { x: number; y: number }): MixNode {
    const at = { x: Math.round(position.x), y: Math.round(position.y) };
    switch (kind) {
        case 'split':
            return { id, kind, splitBy: 'genre', branches: [{ values: [] }], ...at };
        case 'limitShare':
            return { id, kind, percent: 10, per: 'hour', ...at };
        case 'limitCount':
            return { id, kind, count: 1, per: 'show', ...at };
        case 'require':
            return { id, kind, requireGenres: [], requireMode: 'any', afterPercent: 40, ...at };
        case 'timeSwitch':
            return { id, kind, fromHour: 22, thenValue: 30, elseValue: 10, ...at };
        case 'block':
            return { id, kind, bands: [], ...at };
        default:
            return { id, kind, ...at };
    }
}

/** A flow to start from: Picks wired straight to On air, which plays exactly as a show with no flow. */
export function starterFlow(): MixFlow {
    return {
        version: 1,
        nodes: [
            { id: 'picks', kind: 'picks', x: 0, y: 160 },
            { id: 'air', kind: 'onAir', x: 720, y: 160 },
        ],
        links: [{ from: 'picks', out: 0, to: 'air', in: 0 }],
    };
}

/** A node id not in use yet: the kind and the next free number, which reads well in a refusal. */
export function nextId(kind: MixKind, nodes: readonly Pick<MixNode, 'id'>[]): string {
    const taken = new Set(nodes.map(node => node.id));
    for (let index = 1; ; index += 1) {
        const id = `${kind}-${index}`;
        if (!taken.has(id)) return id;
    }
}

/** A split by these reads a branch's values; the others read its range. */
export const SPLIT_BY_VALUES = new Set<NonNullable<MixNode['splitBy']>>(['genre', 'artist', 'decade', 'lastGenre', 'judged']);

/** Which part of a node each problem is about, so the canvas can mark the node. */
export interface FlowProblem {
    nodeId?: string;
    kind:
        | 'onePicks'
        | 'oneOnAir'
        | 'leadsNowhere'
        | 'branchLeadsNowhere'
        | 'nothingWiredIn'
        | 'noBands'
        | 'noSplitBy'
        | 'noBranches'
        | 'emptyBranch'
        | 'noQuestion'
        | 'noAmount'
        | 'noCount'
        | 'nothingRequired'
        | 'switchUnfinished'
        | 'circle'
        | 'unreached'
        | 'cannotBypass';
    output?: number;
}

/**
 * What would stop the flow running, as the canvas marks it. The station's own check is the authority;
 * this is the part of it a canvas can show while the wires are being drawn.
 */
export function flowProblems(flow: MixFlow): FlowProblem[] {
    const problems: FlowProblem[] = [];
    if (flow.nodes.filter(node => node.kind === 'picks').length !== 1) problems.push({ kind: 'onePicks' });
    if (flow.nodes.filter(node => node.kind === 'onAir').length !== 1) problems.push({ kind: 'oneOnAir' });

    const used = new Set(flow.links.map(link => `${link.from}:${link.out}`));
    const fed = new Set(
        flow.links.filter(link => socketsOf(nodeOf(flow, link.to) ?? { kind: 'merge' }).ins[link.in] === 'records').map(link => link.to),
    );
    for (const node of flow.nodes) {
        const { ins, outs } = socketsOf(node);
        outs.forEach((type, output) => {
            if (type !== 'records' || used.has(`${node.id}:${output}`)) return;
            problems.push(
                node.kind === 'split' ? { nodeId: node.id, kind: 'branchLeadsNowhere', output } : { nodeId: node.id, kind: 'leadsNowhere' },
            );
        });
        if (ins.includes('records') && !fed.has(node.id)) problems.push({ nodeId: node.id, kind: 'nothingWiredIn' });
        const own = ownProblem(node, flow.links);
        if (own !== undefined) problems.push({ nodeId: node.id, kind: own });
        if (node.bypassed === true && !canBypass(node)) problems.push({ nodeId: node.id, kind: 'cannotBypass' });
    }

    // No circles, and nothing a record can never reach: the station's own two checks, so a flow the
    // canvas calls ready is one the save takes.
    const next = new Map<string, string[]>();
    for (const link of flow.links) next.set(link.from, [...(next.get(link.from) ?? []), link.to]);
    const reached = new Set<string>();
    const state = new Map<string, 'open' | 'done'>();
    const visit = (id: string): boolean => {
        if (state.get(id) === 'done') return false;
        if (state.get(id) === 'open') return true;
        state.set(id, 'open');
        reached.add(id);
        const looped = (next.get(id) ?? []).some(visit);
        state.set(id, 'done');
        return looped;
    };
    const sources = flow.nodes.filter(node => node.kind === 'picks' || node.kind === 'require' || node.kind === 'timeSwitch');
    if (sources.map(node => visit(node.id)).some(Boolean)) problems.push({ kind: 'circle' });
    for (const node of flow.nodes) if (!reached.has(node.id)) problems.push({ nodeId: node.id, kind: 'unreached' });
    return problems;
}

/** Whether a node is a rule that can be switched off. Picks, On air and a Merge are not rules. */
export function canBypass(node: Pick<MixNode, 'kind'>): boolean {
    return node.kind !== 'picks' && node.kind !== 'onAir' && node.kind !== 'merge';
}

/** The links without any that touch a node, which is what "take its wires off" leaves. */
export function unwire(links: readonly MixLink[], nodeId: string): MixLink[] {
    return links.filter(link => link.from !== nodeId && link.to !== nodeId);
}

function nodeOf(flow: MixFlow, id: string): MixNode | undefined {
    return flow.nodes.find(node => node.id === id);
}

function ownProblem(node: MixNode, links: readonly MixLink[]): FlowProblem['kind'] | undefined {
    switch (node.kind) {
        case 'block':
            return (node.bands?.length ?? 0) === 0 ? 'noBands' : undefined;
        case 'split': {
            if (node.splitBy === undefined) return 'noSplitBy';
            const branches = node.branches ?? [];
            if (branches.length === 0) return 'noBranches';
            if (node.splitBy === 'judged' && (node.question ?? '').trim() === '') return 'noQuestion';
            if (SPLIT_BY_VALUES.has(node.splitBy)) return branches.some(branch => (branch.values?.length ?? 0) === 0) ? 'emptyBranch' : undefined;
            return branches.some(branch => branch.min === undefined && branch.max === undefined) ? 'emptyBranch' : undefined;
        }
        case 'limitShare':
            return node.percent === undefined && !links.some(link => link.to === node.id && link.in === 1) ? 'noAmount' : undefined;
        case 'limitCount':
            return node.count === undefined ? 'noCount' : undefined;
        case 'require':
            return (node.requireGenres?.length ?? 0) === 0 && (node.songs?.length ?? 0) === 0 ? 'nothingRequired' : undefined;
        case 'timeSwitch':
            return node.fromHour === undefined || node.thenValue === undefined || node.elseValue === undefined ? 'switchUnfinished' : undefined;
        default:
            return undefined;
    }
}

/**
 * The links after a split's branch list changed, so each wire stays on the branch it was drawn from.
 * Removing branch `removed` drops its wire and moves every later output up one; adding a branch at the
 * end moves the "everything else" wire down one.
 */
export function relinkSplit(links: readonly MixLink[], nodeId: string, change: { removed: number } | { addedAt: number }): MixLink[] {
    return links.flatMap(link => {
        if (link.from !== nodeId) return [link];
        if ('removed' in change) {
            if (link.out === change.removed) return [];
            return [link.out > change.removed ? { ...link, out: link.out - 1 } : link];
        }
        return [link.out >= change.addedAt ? { ...link, out: link.out + 1 } : link];
    });
}

/** "Thriller — Michael Jackson" or "Thriller - Michael Jackson" as a song, or nothing without both halves. */
export function songOf(text: string): { title: string; artist: string } | undefined {
    const match = /^(.+?)\s+[—–-]\s+(.+)$/.exec(text.trim());
    if (match === null) return undefined;
    const title = match[1]!.trim();
    const artist = match[2]!.trim();
    return title.length > 0 && artist.length > 0 ? { title, artist } : undefined;
}

export const songText = (song: { title: string; artist: string }) => `${song.title} — ${song.artist}`;
