// What going on air as a slot asks for, for the festival a slot names: it rides the order's rules so every
// refill and every break of the show reads it, and a slot naming none asks for none.

import { describe, expect, it } from 'vitest';

import { rulesAskedFor } from '../../../src/modules/director/director.console.service.js';
import type { ScheduleSlot } from '../../../src/modules/director/schedule.js';
import { slotInput } from '../../../src/modules/director/slot.input.js';

const slot = (over: Partial<ScheduleSlot> = {}): ScheduleSlot => ({
    id: 'weekend',
    label: 'Festival weekend',
    startsAtMinutes: 12 * 60,
    endsAtMinutes: 18 * 60,
    days: [],
    mode: 'rotation',
    onEnd: 'extend',
    ...over,
});

describe('slotInput, for a festival', () => {
    it('carries the festival onto the broadcast and from there onto its rules', () => {
        const input = slotInput(slot({ festivalId: 'f1' }));

        expect(input.festivalId).toBe('f1');
        expect(rulesAskedFor(input).rules).toEqual({ festivalId: 'f1' });
    });

    it('keeps the festival for a block started without its source', () => {
        expect(slotInput(slot({ festivalId: 'f1' }), { withoutSource: true }).festivalId).toBe('f1');
    });

    it('asks for no festival when the slot names none', () => {
        const input = slotInput(slot());

        expect(input).not.toHaveProperty('festivalId');
        expect(rulesAskedFor(input)).toEqual({});
    });
});

describe('slotInput, for music beds', () => {
    it("carries a show's dry breaks onto its broadcast and its rules", () => {
        const input = slotInput(slot({ beds: false }));

        expect(input).toMatchObject({ beds: false });
        expect(rulesAskedFor(input).rules).toEqual({ beds: false });
    });

    it('says nothing for a show that never answered, which is beds wherever the library has them', () => {
        expect(slotInput(slot())).not.toHaveProperty('beds');
    });
});

describe('slotInput, for a mix flow', () => {
    const flow = {
        version: 1,
        nodes: [
            { id: 'picks', kind: 'picks' as const },
            { id: 'air', kind: 'onAir' as const },
        ],
        links: [{ from: 'picks', out: 0, to: 'air', in: 0 }],
    };

    it("carries a show's flow onto its broadcast and its rules", () => {
        const input = slotInput(slot({ mixFlow: flow }));

        expect(input.mixFlow).toEqual(flow);
        expect(rulesAskedFor(input).rules).toEqual({ mixFlow: flow });
    });

    it('carries no flow for a show with none, or with one that has no nodes', () => {
        expect(slotInput(slot())).not.toHaveProperty('mixFlow');
        expect(slotInput(slot({ mixFlow: { version: 1, nodes: [], links: [] } }))).not.toHaveProperty('mixFlow');
    });
});

describe('slotInput, for a show with a description', () => {
    it('leaves the description behind: it is for listeners, and never reaches the order or a prompt', () => {
        const input = slotInput(slot({ brief: 'nothing after 1985', description: 'Soul and funk for the small hours.' }));

        expect(input.brief).toBe('nothing after 1985');
        expect(JSON.stringify(input)).not.toContain('Soul and funk');
        expect(JSON.stringify(slotInput(slot({ description: 'Soul and funk for the small hours.' }), { withoutSource: true }))).not.toContain(
            'Soul and funk',
        );
    });
});
