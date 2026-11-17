import type { MixFlow, MixNode } from './types/mix.types.js';

/** What a socket carries: records, or a number (a `timeSwitch`'s value, wired into a `limitShare`). */
export type MixSocketType = 'records' | 'number';

export type MixNodeKind = MixNode['kind'];

/**
 * The sockets a node has, by number, as the canvas draws them and the contract describes them.
 *
 * One table for the validator, the evaluator and anything else that has to agree on what socket 1 of
 * a `limitShare` is. A `split` has one output per branch and then "everything else".
 */
export function socketsOf(node: Pick<MixNode, 'kind' | 'branches'>): { ins: readonly MixSocketType[]; outs: readonly MixSocketType[] } {
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

/** Whether a flow says anything at all. Absent and no nodes are the same: the show plays as it would without one. */
export function hasMixFlow(flow: MixFlow | undefined): flow is MixFlow {
    return flow !== undefined && flow.nodes.length > 0;
}
