// A mix flow read as a list: the rules in the order a record meets them, a split's branches indented
// under it, a Require listed after the main line, and nothing at all for a flow a list would draw wrong.

import { describe, expect, it } from 'vitest';
import type { MixFlow, MixLink } from '@deadair/sdk';

import { mixOutline, type OutlineLine } from '../../../src/components/mix/mix.outline';

const wire = (from: string, to: string, out = 0, into = 0): MixLink => ({ from, out, to, in: into });

const church = (): MixFlow => ({
    version: 1,
    nodes: [
        { id: 'picks', kind: 'picks' },
        { id: 'block', kind: 'block', bands: ['Burzum'] },
        { id: 'split', kind: 'split', splitBy: 'genre', branches: [{ values: ['black metal'] }, { values: ['pop'] }] },
        { id: 'clock', kind: 'timeSwitch', fromHour: 22, thenValue: 30, elseValue: 10 },
        { id: 'share', kind: 'limitShare', per: 'hour' },
        { id: 'row', kind: 'noRepeat' },
        { id: 'pop', kind: 'require', requireGenres: ['pop'], afterPercent: 40 },
        { id: 'merge', kind: 'merge' },
        { id: 'air', kind: 'onAir' },
    ],
    links: [
        wire('picks', 'block'),
        wire('block', 'split'),
        wire('split', 'share', 0),
        wire('clock', 'share', 0, 1),
        wire('split', 'row', 1),
        wire('split', 'merge', 2, 2),
        wire('share', 'merge', 0, 0),
        wire('row', 'merge', 0, 1),
        wire('pop', 'merge', 0, 3),
        wire('merge', 'air'),
    ],
});

/** A line as a short label, so the shape of the list reads at a glance. */
const label = (line: OutlineLine) => `${' '.repeat(line.depth)}${line.kind === 'node' ? line.node.id : `${line.split.id}[${line.index}]`}`;

describe('mixOutline', () => {
    it('reads a flow in the order a record meets it, with each branch under its split and the promise last', () => {
        expect(mixOutline(church())?.map(label)).toEqual(['block', 'split', ' split[0]', '  share', ' split[1]', '  row', ' split[2]', 'pop']);
    });

    it('reads the Time switch with the limit it feeds rather than as a line of its own', () => {
        const share = mixOutline(church())?.find(line => line.kind === 'node' && line.node.id === 'share');
        expect(share?.kind === 'node' ? share.amountFrom?.id : undefined).toBe('clock');
    });

    it('is nothing for branches that come back together at different Merges', () => {
        const flow = church();
        flow.nodes.push({ id: 'other', kind: 'merge' });
        flow.links = flow.links.filter(link => !(link.from === 'row' && link.to === 'merge'));
        flow.links.push(wire('row', 'other'), wire('other', 'air'));
        expect(mixOutline(flow)).toBeUndefined();
    });

    it('is nothing for a flow that never reaches On air', () => {
        const flow = church();
        flow.links = flow.links.filter(link => link.from !== 'merge');
        expect(mixOutline(flow)).toBeUndefined();
    });
});
