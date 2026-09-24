import { Container, Injectable, type ScopedContainer } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { ServerkitError } from '@maroonedsoftware/errors';
import type { InboundMessage } from '@deadair/plugin-sdk';
import { ActorsRepository } from '#modules/authentication/repositories/actors.repository.js';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';
import { DeadairPermissionsTupleRepository } from '#modules/permissions/permissions.repository.js';
import {
    PLATFORM_NAMESPACE,
    PLATFORM_OBJECT_ID,
    isPlatformRoleName,
    rolesGrant,
    type PlatformRoleName,
} from '#modules/permissions/platform.roles.js';
import { PlayoutService } from '#modules/playout/playout.service.js';
import { errorText } from '#modules/shared/error.text.js';
import { inScope } from '#modules/shared/scoped.work.js';
import { hashLinkCode } from './messaging.link.code.js';
import { MessagingRepository } from './messaging.repository.js';

/** What a linked operator can do from a chat. */
export type OperatorVerb = 'skip' | 'onair' | 'offair';

/** What the station says when a chat account that is not a linked operator asks for one. */
export const NOT_AN_OPERATOR =
    'Only a station operator can do that. Link this account from Settings in the station’s console, then send /link with the code.';

/**
 * Who somebody on a chat platform is, and what they may make the station do.
 *
 * ## The link is proof of an account, and the permission is read fresh
 *
 * A console user mints a one-time code and sends it to the bot as `/link CODE`. That proves the chat
 * account belongs to whoever is signed in to the station, and nothing else: whether the account may
 * skip a record is read from the permission tuples on EVERY command, exactly as a request's roles
 * are, so losing the admin role or being deactivated takes effect on the very next one.
 *
 * ## A command runs as the linked user, not as the system
 *
 * The verb runs through `PlayoutService`, the same service the console's buttons call, in a scope
 * whose `AuthorizationContext` is that user. So what the console would refuse, this refuses, and
 * whatever the station writes about the action names the person rather than a job.
 *
 * ## A code seen in a group is burned
 *
 * `/link` works only one to one. A code sent to a group has been read by everybody in it, so it is
 * used up there and then, and the person is told to get another.
 */
@Injectable()
export class MessagingOperator {
    constructor(
        private readonly container: Container,
        private readonly logger: Logger,
    ) {}

    /** `/link CODE`: prove this chat account is the signed-in account that asked for the code. */
    async link(pluginId: string, message: InboundMessage, code: string): Promise<string> {
        if (code.trim() === '') return 'Send /link followed by the code from Settings in the station’s console.';

        const hash = hashLinkCode(code);
        if (message.chatKind !== 'direct') {
            await inScope(this.container, scope => scope.get(MessagingRepository).consumeLinkCode(hash));
            return 'Link codes only work in a direct message to me. Everybody here has seen that one, so it no longer works: get a new one from the console.';
        }

        return inScope(this.container, async scope => {
            const repository = scope.get(MessagingRepository);
            const actorId = await repository.consumeLinkCode(hash);
            if (actorId === undefined) return 'That code does not work. A code lasts ten minutes and works once: get a new one from the console.';

            await repository.link(pluginId, message.sender.id, actorId, message.sender.displayName);
            this.logger.info('messaging: a chat account was linked to a station account', { pluginId, actorId });
            return 'Linked. Operator commands from this account now act as your station account. Send /unlink to undo it.';
        });
    }

    /** `/unlink`: this chat account stops being anybody's. */
    async unlink(pluginId: string, message: InboundMessage): Promise<string> {
        const removed = await inScope(this.container, scope => scope.get(MessagingRepository).unlink(pluginId, message.sender.id));
        return removed ? 'Unlinked. This account can no longer run operator commands.' : 'This account was not linked to anything.';
    }

    /** An operator verb, run as the linked account when it may, refused in plain words when not. */
    async operate(pluginId: string, message: InboundMessage, verb: OperatorVerb): Promise<string> {
        return inScope(this.container, async scope => {
            const actorId = await scope.get(MessagingRepository).linkedActor(pluginId, message.sender.id);
            if (actorId === undefined) return NOT_AN_OPERATOR;

            if (!(await scope.get(ActorsRepository).existsActive(actorId))) return NOT_AN_OPERATOR;

            const roles = await platformRoles(scope, actorId);
            if (!rolesGrant(roles, PLATFORM_NAMESPACE, 'manage')) return NOT_AN_OPERATOR;

            (scope as ScopedContainer).override(
                AuthorizationContext,
                new AuthorizationContext(
                    { kind: 'user', sessionToken: '', actorId, platformRoles: roles, factors: [] },
                    { requestId: `messaging:${message.id}` },
                ),
            );

            try {
                const playout = scope.get(PlayoutService);
                if (verb === 'skip') await playout.skip();
                else if (verb === 'onair') await playout.start();
                else await playout.stop();
            } catch (error) {
                const said = error instanceof ServerkitError && typeof error.details?.message === 'string' ? error.details.message : undefined;
                if (said === undefined) this.logger.warn(`messaging: an operator command failed (${verb}: ${errorText(error)})`);
                return `That did not work: ${said ?? 'something went wrong, and the station’s log says what'}.`;
            }

            this.logger.info('messaging: ran an operator command from a chat', { pluginId, actorId, verb });
            return verb === 'skip' ? 'Skipped.' : verb === 'onair' ? 'Back on air.' : 'Off the air.';
        });
    }
}

/** The platform roles an account holds, read from the tuples the way a request reads them. */
async function platformRoles(scope: Container, actorId: string): Promise<ReadonlySet<PlatformRoleName>> {
    const relations = await scope
        .get(DeadairPermissionsTupleRepository)
        .listRelationsForSubjectOnObject(
            { namespace: PLATFORM_NAMESPACE, id: PLATFORM_OBJECT_ID },
            { kind: 'concrete', namespace: 'user', id: actorId },
        );
    return new Set(relations.filter(isPlatformRoleName));
}
