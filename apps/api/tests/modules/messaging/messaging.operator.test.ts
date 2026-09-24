// Who a chat account is, and what it may make the station do. Every refusal here is a way a stranger
// in a chat could otherwise skip a record or take the station off the air, so each is pinned: no link,
// a link to an account that has since lost its role or been deactivated, and a code that has been
// seen by a whole group.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Container } from 'injectkit';
import type { Logger } from '@maroonedsoftware/logger';
import { httpError } from '@maroonedsoftware/errors';
import type { InboundMessage } from '@deadair/plugin-sdk';

import { MessagingOperator, NOT_AN_OPERATOR } from '../../../src/modules/messaging/messaging.operator.js';
import { MessagingRepository } from '../../../src/modules/messaging/messaging.repository.js';
import { hashLinkCode, newLinkCode, normaliseLinkCode, LINK_CODE_LENGTH } from '../../../src/modules/messaging/messaging.link.code.js';
import { ActorsRepository } from '../../../src/modules/authentication/repositories/actors.repository.js';
import { AuthorizationContext } from '../../../src/modules/permissions/authorization.context.js';
import { DeadairPermissionsTupleRepository } from '../../../src/modules/permissions/permissions.repository.js';
import { PlayoutService } from '../../../src/modules/playout/playout.service.js';

const stubLogger = (): Logger => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn() }) as unknown as Logger;

const message = (chatKind: InboundMessage['chatKind'] = 'direct'): InboundMessage => ({
    id: 'm-1',
    chatId: 'c-1',
    chatKind,
    sender: { id: 'tg-7', displayName: 'Robin' },
    text: '',
    sentAt: '2026-09-24T12:00:00.000Z',
});

interface World {
    linked?: string;
    liveCodeFor?: { hash: string; actorId: string };
    active: boolean;
    roles: string[];
    playoutFails?: Error;
}

function build(world: World) {
    const repository = {
        consumeLinkCode: vi.fn(async (hash: string) => {
            const live = world.liveCodeFor;
            if (live === undefined || live.hash !== hash) return undefined;
            world.liveCodeFor = undefined;
            return live.actorId;
        }),
        link: vi.fn(async () => undefined),
        unlink: vi.fn(async () => world.linked !== undefined),
        linkedActor: vi.fn(async () => world.linked),
    };
    const playout = {
        skip: vi.fn(async () => {
            if (world.playoutFails) throw world.playoutFails;
        }),
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
    };
    const overrides = new Map<unknown, unknown>();

    const scope = {
        get: (token: unknown) => {
            if (overrides.has(token)) return overrides.get(token);
            if (token === MessagingRepository) return repository;
            if (token === ActorsRepository) return { existsActive: vi.fn(async () => world.active) };
            if (token === DeadairPermissionsTupleRepository) return { listRelationsForSubjectOnObject: vi.fn(async () => world.roles) };
            if (token === PlayoutService) return playout;
            throw new Error('unexpected resolve');
        },
        override: (token: unknown, value: unknown) => overrides.set(token, value),
        disposeAsync: async () => undefined,
    };
    const container = { createScopedContainer: () => scope } as unknown as Container;

    return { operator: new MessagingOperator(container, stubLogger()), repository, playout, overrides };
}

describe('link codes', () => {
    it('are eight characters with nothing easy to misread', () => {
        for (let index = 0; index < 50; index += 1) {
            const code = newLinkCode();
            expect(code).toHaveLength(LINK_CODE_LENGTH);
            expect(code).not.toMatch(/[01ILO]/);
        }
    });

    it('match however they are typed', () => {
        expect(normaliseLinkCode(' abcd-2345 ')).toBe('ABCD2345');
        expect(hashLinkCode('abcd 2345')).toBe(hashLinkCode('ABCD2345'));
    });
});

describe('linking', () => {
    let world: World;
    beforeEach(() => {
        world = { active: true, roles: ['admin'], liveCodeFor: { hash: hashLinkCode('ABCD2345'), actorId: 'actor-1' } };
    });

    it('links the chat account to whoever minted the code', async () => {
        const { operator, repository } = build(world);

        expect(await operator.link('deadair.telegram', message(), 'abcd-2345')).toContain('Linked');
        expect(repository.link).toHaveBeenCalledWith('deadair.telegram', 'tg-7', 'actor-1', 'Robin');
    });

    it('refuses a code that does not match, and links nothing', async () => {
        const { operator, repository } = build(world);

        expect(await operator.link('p', message(), 'WRONG999')).toContain('does not work');
        expect(repository.link).not.toHaveBeenCalled();
    });

    it('burns a code sent to a group, since everybody there has now seen it', async () => {
        const { operator, repository } = build(world);

        expect(await operator.link('p', message('group'), 'ABCD2345')).toContain('only work in a direct message');
        expect(repository.consumeLinkCode).toHaveBeenCalled();
        expect(repository.link).not.toHaveBeenCalled();
        expect(world.liveCodeFor).toBeUndefined();
    });
});

describe('operator commands', () => {
    it('refuses a chat account that is not linked', async () => {
        const { operator, playout } = build({ active: true, roles: ['admin'] });

        expect(await operator.operate('p', message(), 'skip')).toBe(NOT_AN_OPERATOR);
        expect(playout.skip).not.toHaveBeenCalled();
    });

    it('refuses a linked account that is only a listener', async () => {
        const { operator, playout } = build({ linked: 'actor-1', active: true, roles: ['listener'] });

        expect(await operator.operate('p', message(), 'skip')).toBe(NOT_AN_OPERATOR);
        expect(playout.skip).not.toHaveBeenCalled();
    });

    it('refuses a linked account that has been deactivated', async () => {
        const { operator, playout } = build({ linked: 'actor-1', active: false, roles: ['admin'] });

        expect(await operator.operate('p', message(), 'offair')).toBe(NOT_AN_OPERATOR);
        expect(playout.stop).not.toHaveBeenCalled();
    });

    it('runs the verb as the linked operator', async () => {
        const { operator, playout, overrides } = build({ linked: 'actor-1', active: true, roles: ['admin'] });

        expect(await operator.operate('p', message(), 'skip')).toBe('Skipped.');
        expect(playout.skip).toHaveBeenCalled();

        const context = overrides.get(AuthorizationContext) as AuthorizationContext;
        expect(context.actor).toMatchObject({ kind: 'user', actorId: 'actor-1' });
    });

    it('maps each verb to the console’s own control', async () => {
        const { operator, playout } = build({ linked: 'actor-1', active: true, roles: ['admin'] });

        await operator.operate('p', message(), 'onair');
        await operator.operate('p', message(), 'offair');

        expect(playout.start).toHaveBeenCalledTimes(1);
        expect(playout.stop).toHaveBeenCalledTimes(1);
    });

    it('says what the station said when a control refuses', async () => {
        const { operator } = build({
            linked: 'actor-1',
            active: true,
            roles: ['admin'],
            playoutFails: httpError(409).withDetails({ message: 'the stream did not take the skip; it may be down' }),
        });

        expect(await operator.operate('p', message(), 'skip')).toBe('That did not work: the stream did not take the skip; it may be down.');
    });
});
