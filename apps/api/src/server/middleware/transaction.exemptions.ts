// A request either runs inside the per-request DB transaction that
// audit.context.middleware opens, or it is exempt and runs with no wrapping
// transaction. This module makes that set of exemptions declarative and
// extensible instead of a hardcoded inline check, so new opt-outs are added in
// one place with a documented reason.
//
// Two kinds of route legitimately opt out:
//   1. Requests that touch no tenant data and enqueue no jobs (OPTIONS
//      preflight, health/root).
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
// NOTE: an exempt request has NO transaction, so what it gives up is atomicity
// with anything it enqueues, and `AfterCommit` on that path runs when the
// handler returns rather than when a commit lands. An exempt route must
// therefore not send a job describing work that could still fail, and must not
// rely on `AfterCommit` for anything a caller will read back in the same
// request. Today's exemptions (streaming, infra, now-playing) do neither.
//
// This used to say the bar was about the `app.actor_org_id` GUC and the
// org-isolation RLS policies. Neither exists — see
// `docs/todo/row-level-security.md` — and if they are ever built, the GUC being
// `is_local` does make that a third thing an exemption has to clear.

// Minimal request shape the predicates need — avoids coupling to the Koa/ServerKit ctx type.
export type ExemptionRequest = { method: string; path: string };

export type TransactionExemption = (request: ExemptionRequest) => boolean;

// OPTIONS preflight plus the health/root probes touch no tenant data. Both spellings of the probe
// are served (see health.ck) and both are exempt: HealthService answers out of memory, so a probe
// on a short interval must never spend a pooled connection or open a transaction.
export const infraExemption: TransactionExemption = ({ method, path }) =>
    method === 'OPTIONS' || path === '/' || path === '/health' || path === '/healthcheck';

// Streaming media/content routes return large bodies from the storage backend, not the DB, so
// wrapping them in a request transaction would pin a pooled connection for the whole stream. Their
// authz is ReBAC / public-kind, and they enqueue nothing.
export const streamingExemption: TransactionExemption = ({ path }) => path.startsWith('/media/') || path.endsWith('/content');

// The public now-playing answer is served entirely out of memory: the rundown holds what is on air
// and the station's name is pushed into the service at boot. It touches no tenant data and needs no
// database at all, and it is polled — by a hi-fi streamer, a station page, whatever displays the track
// — every few seconds by every consumer at once, which is not a reason to spend a pooled connection
// and a transaction each time. Anything that grows a database read here has to come out of this list.
export const nowPlayingExemption: TransactionExemption = ({ method, path }) => method === 'GET' && path === '/nowplaying';

// The exemptions applied by default. Compose additional ones onto this list where the middleware is
// wired (setup.middleware) when a new opt-out route is introduced.
export const DEFAULT_TRANSACTION_EXEMPTIONS: readonly TransactionExemption[] = [infraExemption, streamingExemption, nowPlayingExemption];

export const isTransactionExempt = (request: ExemptionRequest, exemptions: readonly TransactionExemption[]): boolean =>
    exemptions.some(exemption => exemption(request));
