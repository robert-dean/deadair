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

// Minimal request shape the predicates need — avoids coupling to the Koa/ServerKit ctx type.
export type ExemptionRequest = { method: string; path: string };

export type TransactionExemption = (request: ExemptionRequest) => boolean;

// OPTIONS preflight plus the health/root probes touch no tenant data.
export const infraExemption: TransactionExemption = ({ method, path }) => method === 'OPTIONS' || path === '/' || path === '/healthcheck';

// Streaming media/content routes return large bodies from the storage backend, not the DB, so
// wrapping them in a request transaction would pin a pooled connection for the whole stream. Their
// authz is ReBAC / public-kind, so they don't rely on org RLS.
export const streamingExemption: TransactionExemption = ({ path }) => path.startsWith('/media/') || path.endsWith('/content');

// The exemptions applied by default. Compose additional ones onto this list where the middleware is
// wired (setup.middleware) when a new opt-out route is introduced.
export const DEFAULT_TRANSACTION_EXEMPTIONS: readonly TransactionExemption[] = [infraExemption, streamingExemption];

export const isTransactionExempt = (request: ExemptionRequest, exemptions: readonly TransactionExemption[]): boolean =>
    exemptions.some(exemption => exemption(request));
