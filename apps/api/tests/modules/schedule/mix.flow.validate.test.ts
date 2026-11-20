// What a show's mix flow must be before it can be saved: wires between real sockets, every record
// output leading on, no circles, and each node saying what it needs to. A flow that saved wrong would
// not fail loudly on air, it would drop records or send everything one way, so each of these is a
// refusal at the save.

import { describe, expect, it } from 'vitest';

import { mixFlowProblems } from '../../../src/modules/schedule/mix.flow.validate.js';
import type { MixFlow, MixLink, MixNode } from '../../../src/modules/schedule/types/mix.types.js';

const wire = (from: string, to: string, out = 0, into = 0): MixLink => ({ from, out, to, in: into });

/** The Church flow: block Burzum, split black metal and pop, limit each, then on air. */
const church = (): MixFlow => ({
    version: 1,
    nodes: [
        { id: 'picks', kind: 'picks' },
        { id: 'block', kind: 'block', bands: ['Burzum'] },
        { id: 'split', kind: 'split', splitBy: 'genre', branches: [{ values: ['black metal'] }, { values: ['pop'] }] },
        { id: 'clock', kind: 'timeSwitch', fromHour: 22, thenValue: 30, elseValue: 10 },
        { id: 'share', kind: 'limitShare', per: 'hour' },
        { id: 'count', kind: 'limitCount', count: 1, per: 'show' },
        { id: 'pop', kind: 'require', requireGenres: ['pop'], afterPercent: 40 },
        { id: 'merge', kind: 'merge' },
        { id: 'air', kind: 'onAir' },
    ],
    links: [
        wire('picks', 'block'),
        wire('block', 'split'),
        wire('split', 'share', 0),
        wire('clock', 'share', 0, 1),
        wire('split', 'count', 1),
        wire('split', 'merge', 2, 2),
        wire('share', 'merge', 0, 0),
        wire('count', 'merge', 0, 1),
        wire('pop', 'merge', 0, 3),
        wire('merge', 'air'),
    ],
});

const replacing = (flow: MixFlow, id: string, node: Partial<MixNode>): MixFlow => ({
    ...flow,
    nodes: flow.nodes.map(candidate => (candidate.id === id ? ({ ...candidate, ...node } as MixNode) : candidate)),
});

describe('mixFlowProblems', () => {
    it('finds nothing wrong with a flow that runs, or with no flow at all', () => {
        expect(mixFlowProblems(church())).toEqual([]);
        expect(mixFlowProblems(undefined)).toEqual([]);
        expect(mixFlowProblems({ version: 1, nodes: [], links: [] })).toEqual([]);
    });

    it('wants exactly one Picks and one On air', () => {
        const flow = church();
        expect(mixFlowProblems({ ...flow, nodes: flow.nodes.filter(node => node.kind !== 'onAir') })).toContain(
            'a flow has exactly one On air node, and this one has 0',
        );
    });

    it('refuses a loose output, which would drop records without a word', () => {
        const flow = church();
        const problems = mixFlowProblems({ ...flow, links: flow.links.filter(link => !(link.from === 'split' && link.out === 1)) });
        expect(problems).toContain('Split "split" has a branch (output 1) that leads nowhere');
        expect(problems).toContain('Limit count "count" has nothing wired into it');
    });

    it('refuses a number wired into records, and an output sent two ways', () => {
        const flow = church();
        expect(mixFlowProblems({ ...flow, links: [...flow.links, wire('clock', 'count')] })).toContain(
            'Limit count "count" takes records on input 0, and "clock" sends number',
        );
        expect(mixFlowProblems({ ...flow, links: [...flow.links, wire('picks', 'air')] })).toContain(
            'Picks "picks" sends output 0 down two wires; a record can only go one way',
        );
    });

    it('lets several wires into a Merge, and refuses two into anything else', () => {
        const flow = church();
        const twice = { ...flow, links: [...flow.links.filter(link => link.from !== 'pop'), wire('pop', 'block')] };
        expect(mixFlowProblems(twice)).toContain('Block "block" has two wires into input 0; join them with a Merge first');
    });

    it('refuses wires that go round in a circle', () => {
        const flow = church();
        const looped = {
            ...flow,
            links: [...flow.links.filter(link => !(link.from === 'merge')), wire('merge', 'block')].filter(link => !(link.from === 'picks')),
        };
        looped.links.push(wire('picks', 'merge', 0, 3));
        expect(mixFlowProblems(looped)).toContain('the wires go round in a circle, so a record would never reach On air');
    });

    it('asks each node for what it needs', () => {
        const flow = church();
        expect(mixFlowProblems(replacing(flow, 'block', { bands: [] }))).toContain('Block "block" names no bands to keep off');
        expect(mixFlowProblems(replacing(flow, 'count', { count: undefined }))).toContain('Limit count "count" has no count');
        expect(mixFlowProblems(replacing(flow, 'split', { branches: [{ values: [] }, { values: ['pop'] }] }))).toContain(
            'Split "split" has a branch that matches nothing',
        );
        expect(mixFlowProblems(replacing(flow, 'pop', { requireGenres: [] }))).toContain('Require "pop" names no genre and no records to add');
    });

    it('takes a percent of its own when nothing is wired into a share limit', () => {
        const flow = church();
        const unwired = { ...flow, links: flow.links.filter(link => link.from !== 'clock'), nodes: flow.nodes.filter(node => node.id !== 'clock') };
        expect(mixFlowProblems(unwired)).toContain('Limit share "share" has no percent, and nothing wired into its amount');
        expect(mixFlowProblems(replacing(unwired, 'share', { percent: 10 }))).toEqual([]);
    });

    it('takes a question for the model, with yes and no as its only answers', () => {
        const judged = replacing(church(), 'split', {
            splitBy: 'judged',
            question: 'a sinful pop hit?',
            branches: [{ values: ['yes'] }, { values: ['no'] }],
        });
        expect(mixFlowProblems(judged)).toEqual([]);
        expect(mixFlowProblems(replacing(judged, 'split', { question: ' ' }))).toContain('Split "split" asks the model nothing; give it a question');
        expect(mixFlowProblems(replacing(judged, 'split', { branches: [{ values: ['maybe'] }, { values: ['no'] }] }))).toContain(
            'Split "split" has a branch for an answer other than yes or no',
        );
    });

    it('splits by energy on the three thirds of the library, and nothing else', () => {
        const energy = replacing(church(), 'split', { splitBy: 'energy', branches: [{ values: ['high'] }, { values: ['low', 'medium'] }] });
        expect(mixFlowProblems(energy)).toEqual([]);
        expect(mixFlowProblems(replacing(energy, 'split', { branches: [{ values: ['loud'] }, { values: ['low'] }] }))).toContain(
            'Split "split" has a branch for an energy other than low, medium or high',
        );
        expect(mixFlowProblems(replacing(energy, 'split', { branches: [{ values: [] }, { values: ['low'] }] }))).toContain(
            'Split "split" has a branch that matches nothing',
        );
    });

    it('lets a rule be bypassed with its wires still checked, and refuses bypassing Picks, On air or a Merge', () => {
        expect(mixFlowProblems(replacing(church(), 'share', { bypassed: true }))).toEqual([]);
        expect(mixFlowProblems(replacing(church(), 'merge', { bypassed: true }))).toContain('Merge "merge" cannot be bypassed');
        expect(mixFlowProblems(replacing(church(), 'picks', { bypassed: true }))).toContain('Picks "picks" cannot be bypassed');
        const loose = replacing(church(), 'block', { bypassed: true });
        expect(mixFlowProblems({ ...loose, links: loose.links.filter(link => link.from !== 'block') })).toContain(
            'Block "block" leads nowhere; wire it on toward On air',
        );
    });
});
