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
// request. Today's exemptions (streaming, infra, art, now-playing, persona
// drafting) do neither.
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

// Cached cover art, which is the same "must not pin a connection" case as streaming and earned its
// own entry by being the one that actually took the pool down.
//
// `ArtService.getArt` is one row read and then bytes off the art store. It writes nothing and
// enqueues nothing, so a transaction buys it no atomicity — what it costs is a pooled connection
// held from the lookup until the last byte is on the socket, for a request whose body does not come
// from the database at all.
//
// The bill for that is paid by the CONSOLE rather than by a listener, and it is not small.
// `station.order.table.tsx` renders a row per item with no virtualisation, so opening the Desk over
// a long running order asks for one `/art/{id}` per row at once: measured on the live station,
// 250 requests for one page load, 122 of them art. Against `DATABASE_POOL_MAX` of 10 that is 250
// transactions queueing for ten connections, and on 2026-08-31 at 18:40 it ended where that has to
// end — 50 requests giving up with `timeout exceeded when trying to connect`, ten seconds each,
// while the station's own control calls were queued behind the same ten.
//
// This does NOT fix the burst itself. Every one of those requests still counts against the rate
// limiter's 100-per-5s budget and most of them are still refused with a 429; what changes is that a
// refused thumbnail no longer costs a database connection on the way. The console asking for
// hundreds of images at once is a separate thing to fix, in the console.
export const artExemption: TransactionExemption = ({ method, path }) => method === 'GET' && path.startsWith('/art/');

// The public now-playing answer is served entirely out of memory: the rundown holds what is on air
// and the station's name is pushed into the service at boot. It touches no tenant data and needs no
// database at all, and it is polled — by a hi-fi streamer, a station page, whatever displays the track
// — every few seconds by every consumer at once, which is not a reason to spend a pooled connection
// and a transaction each time. Anything that grows a database read here has to come out of this list.
export const nowPlayingExemption: TransactionExemption = ({ method, path }) => method === 'GET' && path === '/nowplaying';

// Drafting a persona, which is the "must not pin a connection" case again with the holding time set
// by a language model rather than by a file read.
//
// `PersonasService.generate` writes NOTHING. It hands the model's answer straight back for the
// console to open in its editor, and the operator saves it through the ordinary create route, so
// there is nothing here for a transaction to make atomic. What the transaction cost instead was one
// of `DATABASE_POOL_MAX` connections held idle for the length of a whole generation:
// `persona.writer.ts` gives the call `BUDGET_MS` (4 minutes) plus `MAX_WAIT_MS` (1 minute) waiting
// for the model slot, and against the slow remote model this station is pointed at, most of that
// budget is routinely spent. Ten of those and the pool is gone, which is the art-thumbnail failure
// again with a hundredth of the traffic needed to cause it.
//
// It also reads nothing worth a connection: `LlmService` holds no repository, the model choice comes
// from the config (a layer of `AppConfig`, so no query), and the call is made with `tools: false`,
// which is what keeps a tool round trip from reaching the database behind this exemption's back.
// Anything that gives this route a write, or gives that call its tools, has to come out of this list.
//
// The sibling routes are deliberately NOT here. `POST /personas/import` and the notes and stories
// routes write, so their transaction is doing the job it exists for, and `POST /personas/:id/rehearse`
// runs the break writers and holds a connection the same way this did. Rehearsal is the next
// candidate rather than a fifth entry today: it is worth checking what it writes first.
export const personaDraftExemption: TransactionExemption = ({ method, path }) => method === 'POST' && path === '/personas/generate';

// The exemptions applied by default. Compose additional ones onto this list where the middleware is
// wired (setup.middleware) when a new opt-out route is introduced.
export const DEFAULT_TRANSACTION_EXEMPTIONS: readonly TransactionExemption[] = [
    infraExemption,
    streamingExemption,
    artExemption,
    nowPlayingExemption,
    personaDraftExemption,
];

export const isTransactionExempt = (request: ExemptionRequest, exemptions: readonly TransactionExemption[]): boolean =>
    exemptions.some(exemption => exemption(request));
