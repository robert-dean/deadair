// What a changeover break is about. The property worth pinning is the one judgement the source makes
// for every writer: whether the host who finished is somebody else. Both sides go through
// `PersonaRepository.presenting`, so a broadcast that named nobody is compared as the station's default
// host, which is who actually presented it.

import { describe, expect, it, vi } from 'vitest';

import { CHANGEOVER_CONTEXT, ChangeoverSource, changeoverContext } from '../../../src/modules/director/changeover.source.js';
import type { Persona } from '../../../src/modules/personas/persona.js';

const persona = (id: string): Persona =>
    ({ id, key: id, kinds: ['host' as const], label: id, style: '', defaultHost: id === 'p-default' }) as Persona;

/** A repository with these hosts, and `p-default` as the station's own. */
const source = (known: readonly string[] = ['p-default', 'p-dave', 'p-ruth']) => {
    const personas = {
        presenting: vi.fn(async (id: string | undefined) => (id !== undefined && known.includes(id) ? persona(id) : persona('p-default'))),
        find: vi.fn(async (id: string) => (known.includes(id) ? persona(id) : undefined)),
    };
    return { source: new ChangeoverSource(personas as never), personas };
};

describe('ChangeoverSource', () => {
    it('answers nothing for any kind but its own, which keeps the job free of a branch about changeovers', async () => {
        const { source: changeovers, personas } = source();

        expect(await changeovers.changeoverFor('talkbreak', { outgoingPersonaId: 'p-dave' }, persona('p-ruth'))).toBeUndefined();
        expect(personas.presenting).not.toHaveBeenCalled();
    });

    it('hands over the outgoing host when it was somebody else', async () => {
        const { source: changeovers } = source();

        const change = await changeovers.changeoverFor(
            'changeover',
            { outgoingPersonaId: 'p-dave', outgoingShow: 'Breakfast', incomingShow: 'Afternoons' },
            persona('p-ruth'),
        );

        expect(change).toEqual({ outgoing: persona('p-dave'), outgoingShow: 'Breakfast', incomingShow: 'Afternoons' });
    });

    it('hands over no outgoing host when the same one carries on', async () => {
        const { source: changeovers } = source();

        const change = await changeovers.changeoverFor('changeover', { outgoingPersonaId: 'p-ruth', incomingShow: 'Afternoons' }, persona('p-ruth'));

        expect(change).toEqual({ incomingShow: 'Afternoons' });
    });

    it('thanks every co-host of the show that ended beside its host', async () => {
        const { source: changeovers } = source(['p-default', 'p-wayne', 'p-garth', 'p-sonny']);

        const change = await changeovers.changeoverFor(
            'changeover',
            changeoverContext({ outgoingPersonaId: 'p-wayne', outgoingCoHostPersonaIds: ['p-garth'], outgoingShow: "Wayne's World" }),
            persona('p-sonny'),
        );

        expect(change).toEqual({ outgoing: persona('p-wayne'), outgoingCoHosts: [persona('p-garth')], outgoingShow: "Wayne's World" });
    });

    it('thanks a co-host who is leaving even when the lead carries on, and nobody who is presenting now', async () => {
        const { source: changeovers } = source(['p-default', 'p-wayne', 'p-garth', 'p-cassandra']);

        const change = await changeovers.changeoverFor(
            'changeover',
            changeoverContext({ outgoingPersonaId: 'p-wayne', outgoingCoHostPersonaIds: ['p-garth', 'p-wayne', 'p-gone'] }),
            persona('p-wayne'),
        );

        // Wayne is carrying on and the roster no longer knows `p-gone`, so Garth is the one thanked.
        expect(change).toEqual({ outgoingCoHosts: [persona('p-garth')] });
    });

    it('compares a broadcast that named nobody as the station’s own host', async () => {
        const { source: changeovers } = source();

        // The outgoing show named no host, so the default presented it. A new show also presented by
        // the default is the same host carrying on.
        expect(await changeovers.changeoverFor('changeover', { outgoingShow: 'Breakfast' }, persona('p-default'))).toEqual({
            outgoingShow: 'Breakfast',
        });
        // And one presented by somebody else thanks the default.
        expect((await changeovers.changeoverFor('changeover', {}, persona('p-ruth')))?.outgoing?.id).toBe('p-default');
    });

    it('thanks nobody on a station with no persona at all', async () => {
        const personas = { presenting: vi.fn(async () => undefined) };
        const changeovers = new ChangeoverSource(personas as never);

        expect(await changeovers.changeoverFor('changeover', { incomingShow: 'Afternoons' }, undefined)).toEqual({ incomingShow: 'Afternoons' });
    });

    it('ignores a context value that is not text, since a context is shapeless by design', async () => {
        const { source: changeovers } = source();

        expect(await changeovers.changeoverFor('changeover', { outgoingShow: 42, incomingShow: '  ' }, persona('p-default'))).toEqual({});
    });
});

describe('changeoverContext', () => {
    it('stores what it was given under the keys the source reads, and nothing for an absent fact', () => {
        expect(changeoverContext({ outgoingPersonaId: 'p-dave', incomingShow: ' Afternoons ' })).toEqual({
            [CHANGEOVER_CONTEXT.outgoingPersonaId]: 'p-dave',
            [CHANGEOVER_CONTEXT.incomingShow]: 'Afternoons',
        });
        expect(changeoverContext({ outgoingShow: '' })).toEqual({});
        expect(changeoverContext({ outgoingCoHostPersonaIds: [' p-garth ', ''] })).toEqual({
            [CHANGEOVER_CONTEXT.outgoingCoHostPersonaIds]: 'p-garth',
        });
        expect(changeoverContext({ outgoingCoHostPersonaIds: [] })).toEqual({});
    });
});
