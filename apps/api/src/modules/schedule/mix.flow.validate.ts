import { hasMixFlow, socketsOf } from './mix.flow.shape.js';
import type { MixFlow, MixNode } from './types/mix.types.js';

/** What the canvas calls each kind, so a refusal names the node the operator can see. */
const NAMES: Record<MixNode['kind'], string> = {
    picks: 'Picks',
    onAir: 'On air',
    block: 'Block',
    split: 'Split',
    limitShare: 'Limit share',
    limitCount: 'Limit count',
    noRepeat: 'No two in a row',
    merge: 'Merge',
    require: 'Require',
    timeSwitch: 'Time switch',
};

/** Split bases that match a branch's `values`; the rest match its `min`/`max` range. */
const BY_VALUES = new Set(['genre', 'artist', 'decade', 'lastGenre', 'judged', 'energy']);

/** What a branch of an energy split may name: a third of the library. */
const ENERGY_VALUES = new Set(['low', 'medium', 'high']);

/**
 * Every reason a flow cannot be saved, each naming the node it is about, or none.
 *
 * A flow that saved wrong would not fail loudly: a loose wire drops records, a cycle never finishes, a
 * split with no basis sends everything one way. So all of that is refused at the save, where the
 * operator is looking at the canvas, rather than discovered on air. An absent or empty flow is fine: it
 * is no flow.
 *
 * Every record output must lead somewhere and only On air has none, so with no cycles every path ends
 * at On air; that is what lets the station follow a record down the wires without a dead end.
 */
export function mixFlowProblems(flow: MixFlow | undefined): string[] {
    if (!hasMixFlow(flow)) return [];
    const problems: string[] = [];
    const say = (node: MixNode, what: string) => problems.push(`${NAMES[node.kind]} "${node.id}" ${what}`);

    const byId = new Map<string, MixNode>();
    for (const node of flow.nodes) {
        if (byId.has(node.id)) problems.push(`two nodes are called "${node.id}"`);
        byId.set(node.id, node);
    }
    for (const kind of ['picks', 'onAir'] as const) {
        const count = flow.nodes.filter(node => node.kind === kind).length;
        if (count !== 1) problems.push(`a flow has exactly one ${NAMES[kind]} node, and this one has ${count}`);
    }

    // Wires: real sockets, like to like, one wire per output, one per input but Merge's.
    const outUsed = new Set<string>();
    const inUsed = new Set<string>();
    const next = new Map<string, string[]>();
    const fedRecords = new Set<string>();
    for (const link of flow.links) {
        const from = byId.get(link.from);
        const to = byId.get(link.to);
        if (from === undefined || to === undefined) {
            problems.push(`a wire runs from "${link.from}" to "${link.to}", and ${from === undefined ? link.from : link.to} is not a node`);
            continue;
        }
        const outType = socketsOf(from).outs[link.out];
        const inType = socketsOf(to).ins[link.in];
        if (outType === undefined) {
            say(from, `has no output ${link.out}`);
            continue;
        }
        if (inType === undefined) {
            say(to, `has no input ${link.in}`);
            continue;
        }
        if (outType !== inType) {
            say(to, `takes ${inType} on input ${link.in}, and "${from.id}" sends ${outType}`);
            continue;
        }
        const outKey = `${from.id}:${link.out}`;
        if (outUsed.has(outKey)) say(from, `sends output ${link.out} down two wires; a record can only go one way`);
        outUsed.add(outKey);
        const inKey = `${to.id}:${link.in}`;
        if (to.kind !== 'merge' && inUsed.has(inKey)) say(to, `has two wires into input ${link.in}; join them with a Merge first`);
        inUsed.add(inKey);
        next.set(from.id, [...(next.get(from.id) ?? []), to.id]);
        if (inType === 'records') fedRecords.add(to.id);
    }

    for (const node of flow.nodes) {
        const { ins, outs } = socketsOf(node);
        outs.forEach((type, index) => {
            if (type === 'records' && !outUsed.has(`${node.id}:${index}`)) {
                say(node, node.kind === 'split' ? `has a branch (output ${index}) that leads nowhere` : 'leads nowhere; wire it on toward On air');
            }
        });
        if (ins.includes('records') && !fedRecords.has(node.id)) say(node, 'has nothing wired into it');
        problems.push(...kindProblems(node, inUsed).map(what => `${NAMES[node.kind]} "${node.id}" ${what}`));
        // Switched off is a state of a rule, and these three are not rules: without Picks or On air no record
        // moves at all, and a Merge only joins wires.
        if (node.bypassed === true && (node.kind === 'picks' || node.kind === 'onAir' || node.kind === 'merge')) say(node, 'cannot be bypassed');
    }

    // No cycles, and nothing unreachable: every node is reached from Picks, a Require or a Time switch.
    const sources = flow.nodes.filter(node => node.kind === 'picks' || node.kind === 'require' || node.kind === 'timeSwitch').map(node => node.id);
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
    if (sources.some(visit)) problems.push('the wires go round in a circle, so a record would never reach On air');
    for (const node of flow.nodes) if (!reached.has(node.id)) say(node, 'is not reached from Picks or a Require');

    return problems;
}

function kindProblems(node: MixNode, inUsed: ReadonlySet<string>): string[] {
    switch (node.kind) {
        case 'block':
            return (node.bands?.length ?? 0) === 0 ? ['names no bands to keep off'] : [];
        case 'split': {
            if (node.splitBy === undefined) return ['does not say what it splits by'];
            if (node.splitBy === 'judged') {
                if (node.question === undefined || node.question.trim() === '') return ['asks the model nothing; give it a question'];
                const answers = (node.branches ?? []).flatMap(branch => branch.values ?? []);
                if (answers.some(answer => answer !== 'yes' && answer !== 'no')) return ['has a branch for an answer other than yes or no'];
            }
            if (node.splitBy === 'energy') {
                const levels = (node.branches ?? []).flatMap(branch => branch.values ?? []);
                if (levels.some(level => !ENERGY_VALUES.has(level))) return ['has a branch for an energy other than low, medium or high'];
            }
            const branches = node.branches ?? [];
            if (branches.length === 0) return ['has no branches'];
            if (BY_VALUES.has(node.splitBy)) {
                return branches.some(branch => (branch.values?.length ?? 0) === 0) ? ['has a branch that matches nothing'] : [];
            }
            return branches.some(branch => branch.min === undefined && branch.max === undefined) ? ['has a branch with no range'] : [];
        }
        case 'limitShare':
            return node.percent === undefined && !inUsed.has(`${node.id}:1`) ? ['has no percent, and nothing wired into its amount'] : [];
        case 'limitCount':
            return node.count === undefined ? ['has no count'] : [];
        case 'require':
            return (node.requireGenres?.length ?? 0) === 0 && (node.songs?.length ?? 0) === 0 ? ['names no genre and no records to add'] : [];
        case 'timeSwitch':
            return node.fromHour === undefined || node.thenValue === undefined || node.elseValue === undefined
                ? ['needs an hour, a value from it and a value before it']
                : [];
        case 'picks':
        case 'onAir':
        case 'noRepeat':
        case 'merge':
            return [];
    }
}
