import type { MixFlow, MixNode } from '@deadair/sdk';

/** One line of a flow read as a list: a rule, or the heading of one branch of a split. */
export type OutlineLine =
    | {
          kind: 'node';
          depth: number;
          node: MixNode;
          /** For a Limit share: the Time switch wired into its amount, which the line reads with it. */
          amountFrom?: MixNode;
      }
    | {
          kind: 'branch';
          depth: number;
          split: MixNode;
          /** Which output: a branch by number, or `branches.length` for "everything else". */
          index: number;
      };

/**
 * A show's mix flow as indented lines, the way it would be said: never Burzum; split by main genre,
 * black metal at most 10% an hour, pop never two in a row; promise a pop record after 40%.
 *
 * ## What a list can say, and what it cannot
 *
 * A flow read from Picks along its wires is a list as long as every split's branches come back
 * together at one Merge (or each run on to On air), which is how every flow drawn so far is shaped.
 * A Require is a second way in, so it is listed after the main line. A Time switch is a number, so it
 * is read with the limit it feeds rather than as a line of its own.
 *
 * Anything else (branches that join different Merges, a wire that never reaches On air) answers
 * `undefined`, and the page offers the canvas instead, because a list that drew such a flow wrongly
 * would be worse than no list.
 */
export function mixOutline(flow: MixFlow): OutlineLine[] | undefined {
    const byId = new Map(flow.nodes.map(node => [node.id, node]));
    const next = (id: string, out = 0): MixNode | undefined => {
        const link = flow.links.find(candidate => candidate.from === id && candidate.out === out);
        return link === undefined ? undefined : byId.get(link.to);
    };
    const amountFrom = (node: MixNode): MixNode | undefined => {
        const link = flow.links.find(candidate => candidate.to === node.id && candidate.in === 1);
        return link === undefined ? undefined : byId.get(link.from);
    };
    // Bounds the walk on a flow with a circle, which the save refuses anyway.
    let budget = flow.nodes.length * 4 + 8;

    /** The rules from `start` until On air, or until a Merge when inside a branch. */
    const run = (start: MixNode | undefined, depth: number): { lines: OutlineLine[]; end: MixNode } | undefined => {
        const lines: OutlineLine[] = [];
        let node = start;
        while (node !== undefined) {
            if ((budget -= 1) < 0) return undefined;
            if (node.kind === 'onAir') return { lines, end: node };
            if (node.kind === 'merge') {
                if (depth > 0) return { lines, end: node };
                node = next(node.id);
                continue;
            }
            if (node.kind === 'split') {
                lines.push({ kind: 'node', depth, node });
                const outputs = (node.branches?.length ?? 0) + 1;
                let joined: MixNode | undefined;
                for (let index = 0; index < outputs; index += 1) {
                    lines.push({ kind: 'branch', depth: depth + 1, split: node, index });
                    const branch = run(next(node.id, index), depth + 2);
                    if (branch === undefined) return undefined;
                    if (joined !== undefined && joined.id !== branch.end.id) return undefined;
                    joined = branch.end;
                    lines.push(...branch.lines);
                }
                if (joined === undefined || joined.kind === 'onAir') return joined === undefined ? undefined : { lines, end: joined };
                // Back together: carry on after the Merge at this depth.
                node = next(joined.id);
                continue;
            }
            if (node.kind !== 'picks' && node.kind !== 'require' && node.kind !== 'timeSwitch') {
                const fed = node.kind === 'limitShare' ? amountFrom(node) : undefined;
                lines.push({ kind: 'node', depth, node, ...(fed === undefined ? {} : { amountFrom: fed }) });
            }
            node = next(node.id);
        }
        return undefined;
    };

    const picks = flow.nodes.find(node => node.kind === 'picks');
    if (picks === undefined) return undefined;
    const main = run(next(picks.id), 0);
    if (main === undefined) return undefined;
    const promises = flow.nodes.filter(node => node.kind === 'require').map((node): OutlineLine => ({ kind: 'node', depth: 0, node }));
    return [...main.lines, ...promises];
}
