// A request either runs inside the per-request DB transaction that
// audit.context.middleware opens, or it is exempt and runs with no wrapping
// transaction. This module makes that set of exemptions declarative and
// extensible instead of a hardcoded inline check, so new opt-outs are added in
// one place with a documented reason.
//
// Two kinds of route legitimately opt out:
//   1. Requests that touch no tenant data and need no org-isolation GUC
//      (OPTIONS preflight, health/root).
//   2. Requests that must NOT pin a pooled connection — and hold its locks —
//      for the whole request lifetime:
//        - streaming responses, whose body comes from the storage backend
//          rather than the DB;
//        - (future) latency-critical paths such as a card-authorization webhook
//          that manages its own short transaction and must release ledger row
//          locks before the HTTP response completes. Such a route adds its own
//          exemption here and commits its write via a dedicated short
//          transaction.
//
// NOTE: an exempt request has NO transaction, so `app.actor_org_id` (set by
// authorization.context with is_local=true) will not survive past a single
// statement — an exempt route therefore must not rely on the org-isolation RLS
// policies. Today's exemptions (streaming, infra) don't; anything added here
// must clear the same bar or open its own transaction.

import { LISTENER_HOOK_PATH } from './listener.credential.middleware.js';

// Minimal request shape the predicates need — avoids coupling to the Koa/ServerKit ctx type.
export type ExemptionRequest = { method: string; path: string };

export type TransactionExemption = (request: ExemptionRequest) => boolean;

// OPTIONS preflight plus the health/root probes touch no tenant data.
export const infraExemption: TransactionExemption = ({ method, path }) => method === 'OPTIONS' || path === '/' || path === '/healthcheck';

// Streaming media/content routes return large bodies from the storage backend, not the DB, so
// wrapping them in a request transaction would pin a pooled connection for the whole stream. Their
// authz is ReBAC / public-kind, so they don't rely on org RLS.
export const streamingExemption: TransactionExemption = ({ path }) => path.startsWith('/media/') || path.endsWith('/content');

// The public now-playing answer is served entirely out of memory: the rundown holds what is on air
// and the station's name is pushed into the service at boot. It touches no tenant data and needs no
// org GUC, and it is polled — by a hi-fi streamer, a station page, whatever is displaying the track
// — every few seconds by every consumer at once, which is not a reason to spend a pooled connection
// and a transaction each time. Anything that grows a database read here has to come out of this list.
export const nowPlayingExemption: TransactionExemption = ({ method, path }) => method === 'GET' && path === '/nowplaying';

// The exemptions applied by default. Compose additional ones onto this list where the middleware is
// wired (setup.middleware) when a new opt-out route is introduced.
// Icecast's listener hook. A listener's own connection is held open waiting for this answer, so it
// is the one route in the app where latency is somebody's silence: it does no database work at all,
// it moves an in-memory reading and returns a constant. Spending a pooled connection and a
// transaction on that would be pure cost, and on a mount that has just been announced somewhere it
// would be one per arriving listener at once.
// Keyed off the same constant the credential middleware and the route itself use, so moving the
// bridge cannot silently un-exempt it: a stale literal here would still compile, still pass every
// test, and quietly put a transaction back on the one path a listener waits out.
export const listenerHookExemption: TransactionExemption = ({ method, path }) => method === 'POST' && path === LISTENER_HOOK_PATH;

export const DEFAULT_TRANSACTION_EXEMPTIONS: readonly TransactionExemption[] = [
    infraExemption,
    streamingExemption,
    nowPlayingExemption,
    listenerHookExemption,
];

export const isTransactionExempt = (request: ExemptionRequest, exemptions: readonly TransactionExemption[]): boolean =>
    exemptions.some(exemption => exemption(request));
