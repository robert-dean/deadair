import { ScopedContainer } from 'injectkit';
import { JobContext } from '@maroonedsoftware/jobbroker';
import { AuthorizationContext } from '#modules/permissions/authorization.context.js';

/**
 * Installs the actor a job runs as, into that execution's scope.
 *
 * The DI-side twin of the `set_config` block in {@link TransactionalJob}, and
 * the job-side counterpart of `authorizationContextMiddleware`: the runner gives
 * every execution its own scoped container, and this is what fills in the
 * "who is this" half of it.
 *
 * Nothing here changes an authorization *outcome*. `AuthorizationContext` is
 * registered with a `{ source: 'startup' }` system actor as its default and
 * `AccessControlService` already trusts every non-`http` system source (the
 * comment on `isTrustedSystemActor` names jobs explicitly), so a job was already
 * permitted before this existed. What it fixes is attribution: the actor now
 * says `pg-boss` rather than `startup`, and carries the job id as the
 * correlation id — the same role `ctx.requestId` plays for a request.
 *
 * A free function rather than a method on {@link TransactionalJob}, because a
 * plain `Job` needs it just as much: a long-running job that deliberately does
 * NOT wrap itself in a transaction still runs as somebody. It is also the one
 * place to change if jobs ever stop being blanket-trusted.
 *
 * Note the deliberate limit: `pg-boss` means *the platform ran this*, not *this
 * user asked for it*. A job acting on someone's behalf has to carry that user's
 * actor, which is a payload concern for whichever job needs it.
 */
export const overrideJobActor = (scope: ScopedContainer, context: JobContext): void => {
    scope.override(
        AuthorizationContext,
        new AuthorizationContext({ kind: 'system', sessionToken: '', source: 'pg-boss' }, { requestId: context.id }),
    );
};
